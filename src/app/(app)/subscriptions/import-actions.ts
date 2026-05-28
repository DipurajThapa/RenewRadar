"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { usersTable } from "@/lib/db/schema";
import {
  createSubscriptionWithRenewalEvent,
  ensureVendor,
} from "@/lib/db/mutations/subscriptions";
import { countActiveSubscriptions } from "@/lib/db/queries/subscriptions";
import { PLAN_LIMITS } from "@/lib/billing/plans";
import { parseSubscriptionCsv } from "@/lib/csv/subscriptions-format";

export type ImportRowResult =
  | { ok: true; rowNumber: number; subscriptionId: string }
  | { ok: false; rowNumber: number; errors: string[] };

export type ImportResult =
  | {
      ok: true;
      imported: number;
      skipped: number;
      rowResults: ImportRowResult[];
    }
  | {
      ok: false;
      formError: string;
      missingColumns?: string[];
    };

/**
 * Server action: import a CSV of subscriptions.
 *
 * Process model:
 *   - Parse the whole blob first; if the header is broken, abort with a
 *     formError before touching the database.
 *   - For every row, validate inline (per-row error array). Rows that fail
 *     validation are reported as `ok: false` and the rest are still imported.
 *   - Each successful row goes through `createSubscriptionWithRenewalEvent`,
 *     which already writes an audit log entry and creates the renewal event.
 *     Reusing it (rather than bulk-inserting) costs one transaction per row
 *     but keeps the audit + renewal-event invariants intact.
 *   - Plan limit is enforced BEFORE any insert. If the import would push the
 *     account over its tier's `maxSubscriptions`, we import what we can fit
 *     and report the rest as skipped (rather than rejecting the whole batch).
 *   - `owner_email` is resolved against the account's users; rows referencing
 *     unknown emails fall back to the importing user as the owner.
 */
export async function importSubscriptionsCsvAction(
  rawCsv: string
): Promise<ImportResult> {
  const { account, user } = await getCurrentAccountAndUser();

  if (typeof rawCsv !== "string" || rawCsv.trim() === "") {
    return { ok: false, formError: "Paste a CSV or upload a file first." };
  }

  const parsed = parseSubscriptionCsv(rawCsv);
  if (!parsed.headerOk) {
    return {
      ok: false,
      formError: `CSV is missing required columns: ${parsed.missingColumns.join(", ")}. Export a sample first to see the expected format.`,
      missingColumns: parsed.missingColumns,
    };
  }

  if (parsed.rows.length === 0) {
    return { ok: false, formError: "No data rows found in the CSV." };
  }

  // Plan limit: how many more rows can we still add this account?
  const limit = PLAN_LIMITS[account.planTier]?.maxSubscriptions;
  let remainingCapacity = Number.POSITIVE_INFINITY;
  if (limit !== undefined && Number.isFinite(limit)) {
    const existing = await countActiveSubscriptions(account.id);
    remainingCapacity = limit - existing;
    if (remainingCapacity < 0) remainingCapacity = 0;
  }

  // Pre-load this account's users so we can resolve owner_email without a
  // round-trip per row.
  const accountUsers = await db
    .select({
      id: usersTable.id,
      workEmail: usersTable.workEmail,
    })
    .from(usersTable)
    .where(eq(usersTable.accountId, account.id));
  const userByEmail = new Map(
    accountUsers.map((u) => [u.workEmail.toLowerCase(), u.id])
  );

  const rowResults: ImportRowResult[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < parsed.rows.length; i++) {
    // 1-indexed display row number that matches the CSV (header is row 1).
    const rowNumber = i + 2;
    const result = parsed.rows[i]!;

    if (!result.ok) {
      rowResults.push({ ok: false, rowNumber, errors: result.errors });
      skipped++;
      continue;
    }

    if (remainingCapacity <= 0) {
      rowResults.push({
        ok: false,
        rowNumber,
        errors: [
          `Plan limit reached (${limit} subscriptions). Upgrade to import this row.`,
        ],
      });
      skipped++;
      continue;
    }

    const row = result.row;

    try {
      const vendor = await ensureVendor({
        accountId: account.id,
        name: row.vendor,
      });

      // Resolve owner_email → user, else fall back to importer.
      let ownerUserId: string | null = user.id;
      if (row.owner_email) {
        const found = userByEmail.get(row.owner_email.toLowerCase());
        if (found) {
          ownerUserId = found;
        }
        // Unknown owner emails fall back silently to the importer — we
        // don't fail the row, just leave a note in the result.
      }

      const sub = await createSubscriptionWithRenewalEvent({
        accountId: account.id,
        vendorId: vendor.id,
        actorUserId: user.id,
        ownerUserId,
        data: {
          productName: row.product,
          planName: row.plan,
          billingCycle: row.billing_cycle as "monthly" | "quarterly" | "annual" | "multi_year",
          termStartDate: row.term_start,
          termEndDate: row.term_end,
          autoRenew: row.auto_renew,
          noticePeriodDays: row.notice_period_days,
          totalSeats: row.seats,
          unitPriceCents: row.unit_price_cents,
          status: "active",
          notes: row.notes,
        },
      });

      rowResults.push({ ok: true, rowNumber, subscriptionId: sub.id });
      imported++;
      remainingCapacity--;
    } catch (err) {
      console.error("[importSubscriptionsCsvAction] row failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      rowResults.push({ ok: false, rowNumber, errors: [msg] });
      skipped++;
    }
  }

  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/action-queue");

  return { ok: true, imported, skipped, rowResults };
}
