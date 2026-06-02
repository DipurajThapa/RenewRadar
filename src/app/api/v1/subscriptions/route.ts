/**
 * /api/v1/subscriptions
 *   - GET: list subscriptions for the authenticated account (paginated).
 *          Defaults to status=active (matches the OpenAPI contract). Pass
 *          ?status=all or a comma-separated subset (e.g. ?status=active,draft)
 *          to widen the filter.
 *   - POST: create a subscription + renewal event
 *
 * Both endpoints reuse the existing application-layer functions so the
 * customer-facing UI and the API are guaranteed to produce identical rows
 * (audit logs, vendor events, renewal events all fire the same).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@server/middleware/api-auth";
import { listSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import {
  createSubscriptionWithRenewalEvent,
  ensureVendor,
} from "@server/application/subscriptions";
import { db } from "@server/infrastructure/db/client";
import { usersTable } from "@server/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// GET — list
// ─────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const auth = await requireApiAuth({
    request,
    requiredScope: "subscriptions:read",
    action: "subscriptions.list",
  });
  if (!auth.ok) return auth.response;
  const { account } = auth.context;

  const url = new URL(request.url);
  const limit = clamp(Number(url.searchParams.get("limit") ?? "50"), 1, 200);

  // The OpenAPI spec promised "active subscriptions" but the repo returned
  // EVERY status (draft, cancelled, expired, …). Honor the documented default
  // here, while exposing an explicit `?status=` for callers that want others.
  // `?status=all` returns every status; comma-separated lists are supported.
  const statusParam = url.searchParams.get("status");
  const allowedStatuses = new Set([
    "active",
    "draft",
    "paused",
    "pending_cancellation",
    "cancelled",
    "expired",
  ]);
  let statusFilter: Set<string> | null;
  if (statusParam == null || statusParam === "") {
    statusFilter = new Set(["active"]);
  } else if (statusParam === "all") {
    statusFilter = null;
  } else {
    statusFilter = new Set(
      statusParam
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => allowedStatuses.has(s))
    );
    if (statusFilter.size === 0) statusFilter = new Set(["active"]);
  }

  const allRows = await listSubscriptions(account.id);
  const filtered = statusFilter
    ? allRows.filter((s) => statusFilter!.has(s.status))
    : allRows;
  // The repo doesn't paginate yet (the dashboard reads all rows). Slice
  // server-side so the API contract supports limit even before the repo
  // grows offset/cursor pagination — added when account sizes warrant it.
  const rows = filtered.slice(0, limit);

  return NextResponse.json({
    // We project the existing SubscriptionRow shape directly. Fields like
    // termStartDate and unitPriceCents will land when the dashboard repo
    // grows them — the OpenAPI schema already declares them so adding
    // them later is backward-compatible.
    data: rows.map((s) => ({
      id: s.id,
      vendor: s.vendorName,
      product: s.productName,
      plan: s.planName,
      status: s.status,
      billingCycle: s.billingCycle,
      termEndDate: s.termEndDate,
      autoRenew: s.autoRenew,
      noticePeriodDays: s.noticePeriodDays,
      totalSeats: s.totalSeats,
      totalCostPerPeriodCents: s.totalCostPerPeriodCents,
      ownerUserId: s.ownerUserId,
    })),
    pagination: {
      limit,
      count: rows.length,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// POST — create
// ─────────────────────────────────────────────────────────────────────────

const createBodySchema = z.object({
  vendor: z.string().min(1).max(200),
  product: z.string().min(1).max(200),
  plan: z.string().max(200).nullable().optional(),
  billingCycle: z.enum(["monthly", "quarterly", "annual", "multi_year"]),
  termStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  termEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  autoRenew: z.boolean(),
  noticePeriodDays: z.number().int().min(0).max(365),
  totalSeats: z.number().int().min(1).max(100_000),
  unitPriceCents: z.number().int().min(0),
  notes: z.string().max(2000).nullable().optional(),
  ownerEmail: z.string().email().optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth({
    request,
    requiredScope: "subscriptions:write",
    action: "subscriptions.create",
  });
  if (!auth.ok) return auth.response;
  const { account, apiKey } = auth.context;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 }
    );
  }
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 422 }
    );
  }
  const data = parsed.data;

  // Resolve owner: lookup by email if provided; else fall back to the
  // account's first owner. There is no Clerk user behind an API call so
  // SOMEONE has to own the row.
  let ownerUserId: string | null = null;
  if (data.ownerEmail) {
    const [match] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.accountId, account.id),
          eq(usersTable.workEmail, data.ownerEmail.toLowerCase())
        )
      )
      .limit(1);
    ownerUserId = match?.id ?? null;
  }
  if (!ownerUserId) {
    const [fallback] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.accountId, account.id),
          eq(usersTable.role, "owner")
        )
      )
      .limit(1);
    ownerUserId = fallback?.id ?? null;
  }
  if (!ownerUserId) {
    return NextResponse.json(
      {
        error: "no_owner",
        message:
          "No user is available to own this subscription. Provision an account owner first.",
      },
      { status: 422 }
    );
  }

  const vendor = await ensureVendor({
    accountId: account.id,
    name: data.vendor,
  });

  const sub = await createSubscriptionWithRenewalEvent({
    accountId: account.id,
    vendorId: vendor.id,
    actorUserId: ownerUserId,
    ownerUserId,
    data: {
      productName: data.product,
      planName: data.plan ?? null,
      billingCycle: data.billingCycle,
      termStartDate: data.termStartDate,
      termEndDate: data.termEndDate,
      autoRenew: data.autoRenew,
      noticePeriodDays: data.noticePeriodDays,
      totalSeats: data.totalSeats,
      unitPriceCents: data.unitPriceCents,
      status: "active",
      notes: data.notes ?? null,
    },
  });

  return NextResponse.json(
    {
      id: sub.id,
      vendor: vendor.name,
      product: sub.productName,
      status: sub.status,
      apiKeyId: apiKey.id, // echo for debugging
    },
    { status: 201, headers: { Location: `/api/v1/subscriptions/${sub.id}` } }
  );
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
