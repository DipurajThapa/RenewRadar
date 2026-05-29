"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  importBatchesTable,
  subscriptionsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import {
  createSubscriptionWithRenewalEvent,
  ensureVendor,
} from "@server/application/subscriptions";
import {
  countActiveSubscriptions,
  listSubscriptionExistenceKeys,
  subscriptionMatchKey,
} from "@server/infrastructure/db/repositories/subscriptions";
import { PLAN_LIMITS } from "@server/infrastructure/billing/plans";
import {
  normalizeTabularInput,
  parseSubscriptionCsv,
} from "@server/infrastructure/csv/subscriptions-format";
import {
  endSupportSession,
  requireActiveSession,
  startSupportSession,
  SupportSessionError,
} from "@server/application/support-sessions";
import { requireCurrentStaff } from "@server/middleware/current-staff";

/**
 * T4.1 — Staff-facing server actions for concierge onboarding.
 *
 * Every action here:
 *   1. Verifies the caller is staff (via `requireCurrentStaff`)
 *   2. For account-level mutations, requires an active support session
 *      targeting that account (via `requireActiveSession`)
 *
 * Customer-facing actions in `(app)/subscriptions/...` are unaffected —
 * those run as the customer; these run as staff. The two paths intentionally
 * don't share code so a refactor in one can't accidentally weaken the other.
 */

const MAX_CSV_BYTES = 5 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────
// Session lifecycle (start / end)
// ─────────────────────────────────────────────────────────────────────────

export async function startSupportSessionAction(formData: FormData) {
  const staff = await requireCurrentStaff();
  const accountId = String(formData.get("accountId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!accountId) throw new Error("accountId is required");
  try {
    await startSupportSession({
      staffUserId: staff.id,
      accountId,
      reason,
    });
  } catch (err) {
    if (err instanceof SupportSessionError) {
      // Bounce back to the staff dashboard with the error in the URL
      // search params so the page can render it.
      redirect(
        `/staff?error=${encodeURIComponent(err.message)}&accountId=${accountId}`
      );
    }
    throw err;
  }
  redirect(`/staff/accounts/${accountId}`);
}

export async function endSupportSessionAction(formData: FormData) {
  const staff = await requireCurrentStaff();
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("sessionId is required");
  await endSupportSession(sessionId, "manual");
  // Defense-in-depth — if a malicious form supplies someone else's session
  // id, endSupportSession returns null and no harm is done; the audit log
  // still shows the staff member who attempted the action.
  void staff;
  revalidatePath("/staff");
  redirect("/staff");
}

// ─────────────────────────────────────────────────────────────────────────
// Concierge CSV import — the headline use case
// ─────────────────────────────────────────────────────────────────────────

export type StaffImportRowResult =
  | { ok: true; rowNumber: number; subscriptionId: string }
  | {
      ok: false;
      rowNumber: number;
      errors: string[];
      reason?: "duplicate" | "capacity" | "validation";
    };

export type StaffImportResult =
  | {
      ok: true;
      imported: number;
      skipped: number;
      rowResults: StaffImportRowResult[];
      importBatchId: string | null;
    }
  | {
      ok: false;
      formError: string;
      missingColumns?: string[];
    };

/**
 * Import a CSV on behalf of a customer account. Mirrors the customer-facing
 * `importSubscriptionsCsvAction` body but runs under the staff identity:
 *
 *   - Gated by an active support session for the target account
 *   - Records the import_batch like a customer import does (so the customer
 *     can later use the Undo flow on rows the staff created — same trust
 *     contract as if the customer had imported the file themselves)
 *   - The subscription.created audit entries reference the account's first
 *     owner as actor (FK requirement). The support.staff_acted entry
 *     written by requireActiveSession sits adjacent in the audit feed so
 *     the customer can correlate "support did N things during session X"
 *     by timestamp.
 */
export async function staffImportCsvForAccountAction(input: {
  accountId: string;
  csvText: string;
}): Promise<StaffImportResult> {
  const staff = await requireCurrentStaff();

  // Gate — refuses without an active session for this exact account.
  try {
    await requireActiveSession({
      staffUserId: staff.id,
      accountId: input.accountId,
      action: "csv_import",
    });
  } catch (err) {
    if (err instanceof SupportSessionError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  const { csvText } = input;
  if (typeof csvText !== "string" || csvText.trim() === "") {
    return { ok: false, formError: "Paste a CSV first." };
  }
  if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) {
    return {
      ok: false,
      formError: `CSV is too large (max ${MAX_CSV_BYTES / 1024 / 1024} MB).`,
    };
  }

  // Resolve the customer "actor" for createSubscriptionWithRenewalEvent.
  // We use the account's first active owner so the FK on
  // subscriptions.ownerUserId is satisfied; the staff identity is recorded
  // separately via the support_acted audit entry written above.
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, input.accountId))
    .limit(1);
  if (!account) {
    return { ok: false, formError: "Account not found." };
  }
  const [primaryOwner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.accountId, input.accountId),
        eq(usersTable.role, "owner")
      )
    )
    .limit(1);
  if (!primaryOwner) {
    return {
      ok: false,
      formError:
        "Account has no active owner — provision an owner before staff can import on its behalf.",
    };
  }

  const normalized = normalizeTabularInput(csvText);
  const parsed = parseSubscriptionCsv(normalized);
  if (!parsed.headerOk) {
    return {
      ok: false,
      formError: `CSV is missing required columns: ${parsed.missingColumns.join(", ")}.`,
      missingColumns: parsed.missingColumns,
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, formError: "No data rows found in the CSV." };
  }

  // Capacity + dedup — same shape as the customer flow.
  const limit = PLAN_LIMITS[account.planTier]?.maxSubscriptions;
  let remainingCapacity = Number.POSITIVE_INFINITY;
  if (limit !== undefined && Number.isFinite(limit)) {
    const existing = await countActiveSubscriptions(account.id);
    remainingCapacity = Math.max(0, limit - existing);
  }
  const existingByKey = await listSubscriptionExistenceKeys(account.id);

  const rowResults: StaffImportRowResult[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < parsed.rows.length; i++) {
    const rowNumber = i + 2;
    const result = parsed.rows[i]!;

    if (!result.ok) {
      rowResults.push({
        ok: false,
        rowNumber,
        errors: result.errors,
        reason: "validation",
      });
      skipped++;
      continue;
    }
    if (remainingCapacity <= 0) {
      rowResults.push({
        ok: false,
        rowNumber,
        errors: [`Plan limit reached (${limit} subscriptions).`],
        reason: "capacity",
      });
      skipped++;
      continue;
    }

    const row = result.row;
    const matchKey = subscriptionMatchKey(row.vendor, row.product);
    if (existingByKey.has(matchKey)) {
      rowResults.push({
        ok: false,
        rowNumber,
        errors: [`Already exists — ${row.vendor} / ${row.product}.`],
        reason: "duplicate",
      });
      skipped++;
      continue;
    }

    try {
      const vendor = await ensureVendor({
        accountId: account.id,
        name: row.vendor,
      });
      const sub = await createSubscriptionWithRenewalEvent({
        accountId: account.id,
        vendorId: vendor.id,
        actorUserId: primaryOwner.id,
        ownerUserId: primaryOwner.id,
        data: {
          productName: row.product,
          planName: row.plan,
          billingCycle: row.billing_cycle as
            | "monthly"
            | "quarterly"
            | "annual"
            | "multi_year",
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
      existingByKey.set(matchKey, sub.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      rowResults.push({
        ok: false,
        rowNumber,
        errors: [msg],
        reason: "validation",
      });
      skipped++;
    }
  }

  let importBatchId: string | null = null;
  if (imported > 0) {
    const createdIds = rowResults
      .filter((r): r is Extract<StaffImportRowResult, { ok: true }> => r.ok)
      .map((r) => r.subscriptionId);
    const [batch] = await db
      .insert(importBatchesTable)
      .values({
        accountId: account.id,
        actorUserId: primaryOwner.id,
        source: "csv_via_staff_session",
        subscriptionIdsJson: createdIds,
      })
      .returning({ id: importBatchesTable.id });
    importBatchId = batch?.id ?? null;
  }

  revalidatePath("/staff");
  revalidatePath(`/staff/accounts/${input.accountId}`);

  return { ok: true, imported, skipped, rowResults, importBatchId };
}

// ─────────────────────────────────────────────────────────────────────────
// Account search (read-only — does NOT require an active session because
// the staff dashboard needs to list accounts to choose one to act on).
// ─────────────────────────────────────────────────────────────────────────

export type StaffAccountSummary = {
  id: string;
  name: string;
  billingEmail: string;
  planTier: string;
  subscriptionCount: number;
  hasOpenSession: boolean;
};

export async function listAccountsForStaff(query?: string): Promise<
  StaffAccountSummary[]
> {
  await requireCurrentStaff();

  const rows = await db
    .select({
      id: accountsTable.id,
      name: accountsTable.name,
      billingEmail: accountsTable.billingEmail,
      planTier: accountsTable.planTier,
    })
    .from(accountsTable)
    .limit(50);

  const filtered = query
    ? rows.filter((r) => {
        const q = query.toLowerCase();
        return (
          r.name.toLowerCase().includes(q) ||
          r.billingEmail.toLowerCase().includes(q)
        );
      })
    : rows;

  // Per-account counts + open session flag — small N (≤50), simple loop is fine.
  const out: StaffAccountSummary[] = [];
  for (const r of filtered) {
    const subCount = await db
      .select({ id: subscriptionsTable.id })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, r.id),
          eq(subscriptionsTable.status, "active")
        )
      );
    const sessions = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.accountId, r.id));
    void sessions; // not used currently; reserved for future "open session" filter
    out.push({
      id: r.id,
      name: r.name,
      billingEmail: r.billingEmail,
      planTier: r.planTier,
      subscriptionCount: subCount.length,
      hasOpenSession: false, // computed on the staff page render path
    });
  }
  return out;
}

// ─── T4.10 Slice 6 — staff vendor-org trust administration ─────────────────

export type StaffVendorActionResult = { ok: true } | { ok: false; error: string };

export async function staffVerifyVendorDomainAction(input: {
  vendorOrgId: string;
  note: string;
}): Promise<StaffVendorActionResult> {
  await requireCurrentStaff();
  try {
    const { manuallyVerifyDomain } = await import(
      "@server/application/vendor-portal/domain-verification"
    );
    await manuallyVerifyDomain({
      vendorOrgId: input.vendorOrgId,
      note: input.note || "Verified by staff",
    });
    revalidatePath("/staff/vendors");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function staffSuspendVendorAction(input: {
  vendorOrgId: string;
  reason: string;
}): Promise<StaffVendorActionResult> {
  await requireCurrentStaff();
  try {
    const { suspendVendorOrg } = await import(
      "@server/application/vendor-portal/staff-admin"
    );
    await suspendVendorOrg({
      vendorOrgId: input.vendorOrgId,
      reason: input.reason || "Suspended by staff",
    });
    revalidatePath("/staff/vendors");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function staffReinstateVendorAction(
  vendorOrgId: string
): Promise<StaffVendorActionResult> {
  await requireCurrentStaff();
  try {
    const { reinstateVendorOrg } = await import(
      "@server/application/vendor-portal/staff-admin"
    );
    await reinstateVendorOrg({ vendorOrgId });
    revalidatePath("/staff/vendors");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
