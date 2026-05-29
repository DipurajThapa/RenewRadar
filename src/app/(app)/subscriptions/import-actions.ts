"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import {
  requireTierFeature,
  TierFeatureDeniedError,
} from "@server/domain/billing/tier-features";
import { db } from "@server/infrastructure/db/client";
import { usersTable } from "@server/infrastructure/db/schema";
import {
  createSubscriptionWithRenewalEvent,
  ensureVendor,
  updateSubscription,
} from "@server/application/subscriptions";
import {
  importBatchesTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
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

/**
 * Hard cap on a single CSV import. 5 MB is comfortably more than a Pro tier's
 * 500-row max would ever produce (typical row is ~150 bytes; 500 rows × 150B
 * = 75 KB). The cap exists to bound memory / parse cost, not to police the
 * tier limit — that's handled per-row below.
 */
const MAX_CSV_BYTES = 5 * 1024 * 1024;

export type ImportRowResult =
  | {
      ok: true;
      rowNumber: number;
      subscriptionId: string;
      /** Vendor name as displayed — surfaced so the post-import owner-assign step doesn't re-query. */
      vendor: string;
      /** Product name as displayed. */
      product: string;
      /** Default owner the import wrote — either resolved from owner_email or the importer. */
      assignedOwnerUserId: string;
    }
  | {
      ok: false;
      rowNumber: number;
      errors: string[];
      /**
       * Set when the row was skipped because an active subscription
       * already exists for the (vendor, product) pair. The UI uses this
       * to distinguish "you already have this" from "this row was
       * invalid" in the result table.
       */
      reason?: "duplicate" | "capacity" | "validation";
    };

export type ImportResult =
  | {
      ok: true;
      imported: number;
      skipped: number;
      rowResults: ImportRowResult[];
      /**
       * Only present when `imported > 0`. The UI exposes this so the user
       * can click "Undo this import" within the 24h window — see
       * `undoImportBatchAction`. Null when nothing was imported (no batch
       * to undo).
       */
      importBatchId: string | null;
    }
  | {
      ok: false;
      formError: string;
      missingColumns?: string[];
    };

/**
 * Preview classification for a single CSV row — what would happen if the
 * user clicked "Confirm import" right now.
 */
export type PreviewRowResult =
  | {
      ok: true;
      rowNumber: number;
      vendor: string;
      product: string;
      annualizedUsdCents: number;
      classification: "would_create" | "duplicate_existing";
      /** Set when classification is `duplicate_existing`. */
      existingSubscriptionId?: string;
    }
  | {
      ok: false;
      rowNumber: number;
      errors: string[];
      reason: "validation" | "capacity";
    };

export type PreviewResult =
  | {
      ok: true;
      /**
       * Totals across all parsed rows. `wouldCreate + duplicateExisting +
       * invalid + overCapacity === rows.length`.
       */
      wouldCreate: number;
      duplicateExisting: number;
      invalid: number;
      overCapacity: number;
      rows: PreviewRowResult[];
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
  try {
    requireRole(user, "member");
    // CSV import is a Starter+ feature. Defense-in-depth — the UI already
    // hides the button for Free Forever.
    requireTierFeature(account.planTier, "csvImportExport");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TierFeatureDeniedError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  if (typeof rawCsv !== "string" || rawCsv.trim() === "") {
    return { ok: false, formError: "Paste a CSV or upload a file first." };
  }
  if (Buffer.byteLength(rawCsv, "utf8") > MAX_CSV_BYTES) {
    return {
      ok: false,
      formError: `CSV is too large (max ${MAX_CSV_BYTES / 1024 / 1024} MB). Split into smaller files.`,
    };
  }

  // Accept both CSV and TSV input. Excel / Google Sheets / Numbers paste
  // tab-delimited by default; saved files are CSV. The normalizer sniffs
  // the delimiter and converts TSV → CSV; CSV input passes through
  // unchanged.
  const normalized = normalizeTabularInput(rawCsv);
  const parsed = parseSubscriptionCsv(normalized);
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

  // Pre-load (vendor, product) → existing subscription IDs so we can skip
  // rows that already exist instead of silently creating duplicates. The
  // preview action shows the user this set up front; the commit must agree.
  const existingByKey = await listSubscriptionExistenceKeys(account.id);

  const rowResults: ImportRowResult[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < parsed.rows.length; i++) {
    // 1-indexed display row number that matches the CSV (header is row 1).
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
        errors: [
          `Plan limit reached (${limit} subscriptions). Upgrade to import this row.`,
        ],
        reason: "capacity",
      });
      skipped++;
      continue;
    }

    const row = result.row;

    // Dedup against existing active subscriptions for this account.
    // Matches the preview action's classification so a customer who saw
    // "3 already exist" in the preview sees those 3 skipped here.
    const matchKey = subscriptionMatchKey(row.vendor, row.product);
    if (existingByKey.has(matchKey)) {
      rowResults.push({
        ok: false,
        rowNumber,
        errors: [
          `Already exists — ${row.vendor} / ${row.product}. Update the existing subscription instead of re-importing.`,
        ],
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

      rowResults.push({
        ok: true,
        rowNumber,
        subscriptionId: sub.id,
        vendor: row.vendor,
        product: row.product,
        assignedOwnerUserId: ownerUserId ?? user.id,
      });
      imported++;
      remainingCapacity--;
      // Record this (vendor, product) so a SECOND row in the same CSV
      // matching the same pair is treated as a duplicate. Without this,
      // a CSV listing "Slack / Business+" twice would create two rows.
      existingByKey.set(matchKey, sub.id);
    } catch (err) {
      console.error("[importSubscriptionsCsvAction] row failed:", err);
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

  // T4.15 — Record the import batch so the user can undo within 24h.
  // Only created when at least one row was actually inserted; an "all
  // skipped" import has nothing to undo.
  let importBatchId: string | null = null;
  if (imported > 0) {
    const createdIds = rowResults
      .filter((r): r is Extract<ImportRowResult, { ok: true }> => r.ok)
      .map((r) => r.subscriptionId);
    const [batch] = await db
      .insert(importBatchesTable)
      .values({
        accountId: account.id,
        actorUserId: user.id,
        source: "csv",
        subscriptionIdsJson: createdIds,
      })
      .returning({ id: importBatchesTable.id });
    importBatchId = batch?.id ?? null;
  }

  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/action-queue");

  return { ok: true, imported, skipped, rowResults, importBatchId };
}

// ─────────────────────────────────────────────────────────────────────────
// T2.5 — Preview action. Reuses every guard the import uses (RBAC, tier,
// payload size, parser, capacity, dedup) but stops before any DB write.
// The UI calls this first, shows a summary, and only invokes the commit
// action when the user clicks "Confirm import."
// ─────────────────────────────────────────────────────────────────────────

export async function previewSubscriptionsImportAction(
  rawCsv: string
): Promise<PreviewResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
    requireTierFeature(account.planTier, "csvImportExport");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TierFeatureDeniedError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  if (typeof rawCsv !== "string" || rawCsv.trim() === "") {
    return {
      ok: false,
      formError: "Paste a CSV or upload a file first.",
    };
  }
  if (Buffer.byteLength(rawCsv, "utf8") > MAX_CSV_BYTES) {
    return {
      ok: false,
      formError: `CSV is too large (max ${MAX_CSV_BYTES / 1024 / 1024} MB). Split into smaller files.`,
    };
  }

  const normalized = normalizeTabularInput(rawCsv);
  const parsed = parseSubscriptionCsv(normalized);

  if (!parsed.headerOk) {
    return {
      ok: false,
      formError: `CSV is missing required columns: ${parsed.missingColumns.join(", ")}. Download the sample CSV to see the expected format.`,
      missingColumns: parsed.missingColumns,
    };
  }

  if (parsed.rows.length === 0) {
    return { ok: false, formError: "No data rows found in the CSV." };
  }

  const limit = PLAN_LIMITS[account.planTier]?.maxSubscriptions;
  let remainingCapacity = Number.POSITIVE_INFINITY;
  if (limit !== undefined && Number.isFinite(limit)) {
    const existing = await countActiveSubscriptions(account.id);
    remainingCapacity = limit - existing;
    if (remainingCapacity < 0) remainingCapacity = 0;
  }

  const existingByKey = await listSubscriptionExistenceKeys(account.id);
  const previewRows: PreviewRowResult[] = [];
  let wouldCreate = 0;
  let duplicateExisting = 0;
  let invalid = 0;
  let overCapacity = 0;

  // Track keys we'd produce in this batch so two rows in the same CSV
  // matching the same (vendor, product) are correctly classified as a
  // duplicate of the FIRST row, not as two `would_create`s.
  const inBatchKeys = new Set<string>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const rowNumber = i + 2;
    const result = parsed.rows[i]!;

    if (!result.ok) {
      previewRows.push({
        ok: false,
        rowNumber,
        errors: result.errors,
        reason: "validation",
      });
      invalid++;
      continue;
    }

    const row = result.row;
    const matchKey = subscriptionMatchKey(row.vendor, row.product);

    // Capacity gate has to come BEFORE the dedup gate so a "you have no
    // headroom" row reads as the over-capacity story, not "duplicate".
    if (remainingCapacity <= 0) {
      previewRows.push({
        ok: false,
        rowNumber,
        errors: [
          `Plan limit reached (${limit} subscriptions). Upgrade to import this row.`,
        ],
        reason: "capacity",
      });
      overCapacity++;
      continue;
    }

    const existingId = existingByKey.get(matchKey) ?? null;
    if (existingId) {
      previewRows.push({
        ok: true,
        rowNumber,
        vendor: row.vendor,
        product: row.product,
        annualizedUsdCents: estimateAnnualizedCents(row),
        classification: "duplicate_existing",
        existingSubscriptionId: existingId,
      });
      duplicateExisting++;
      continue;
    }

    if (inBatchKeys.has(matchKey)) {
      // A previous row in the same batch already covered this pair.
      previewRows.push({
        ok: true,
        rowNumber,
        vendor: row.vendor,
        product: row.product,
        annualizedUsdCents: estimateAnnualizedCents(row),
        classification: "duplicate_existing",
      });
      duplicateExisting++;
      continue;
    }

    previewRows.push({
      ok: true,
      rowNumber,
      vendor: row.vendor,
      product: row.product,
      annualizedUsdCents: estimateAnnualizedCents(row),
      classification: "would_create",
    });
    wouldCreate++;
    remainingCapacity--;
    inBatchKeys.add(matchKey);
  }

  return {
    ok: true,
    wouldCreate,
    duplicateExisting,
    invalid,
    overCapacity,
    rows: previewRows,
  };
}

/**
 * Rough annualized-cents estimate for the preview table. Uses unit price ×
 * seats × periods-per-year. The commit action runs the canonical
 * `createSubscriptionWithRenewalEvent` math; this is a UI hint only.
 */
function estimateAnnualizedCents(row: {
  billing_cycle: string;
  seats: number;
  unit_price_cents: number;
}): number {
  const perPeriod = row.seats * row.unit_price_cents;
  switch (row.billing_cycle) {
    case "monthly":
      return perPeriod * 12;
    case "quarterly":
      return perPeriod * 4;
    case "annual":
      return perPeriod;
    case "multi_year":
      // We don't know term length from this row alone — show the period
      // value, not a multi-year inflated number.
      return perPeriod;
    default:
      return perPeriod;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// T2.6 — Bulk owner reassignment. Called from the import dialog after a
// successful import so the user can reassign the freshly-created rows in
// one screen instead of opening each subscription individually.
// ─────────────────────────────────────────────────────────────────────────

export type BulkReassignResult =
  | {
      ok: true;
      updated: number;
      failed: number;
      /** Per-subscription failure detail; empty when failed === 0. */
      failures: Array<{ subscriptionId: string; error: string }>;
    }
  | { ok: false; formError: string };

const MAX_BULK_ASSIGNMENTS = 500; // matches the Pro tier subscription cap

export async function bulkReassignOwnersAction(input: {
  assignments: Array<{ subscriptionId: string; ownerUserId: string | null }>;
}): Promise<BulkReassignResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  if (!Array.isArray(input.assignments) || input.assignments.length === 0) {
    return {
      ok: false,
      formError: "No assignments to apply — pick at least one row.",
    };
  }
  if (input.assignments.length > MAX_BULK_ASSIGNMENTS) {
    return {
      ok: false,
      formError: `Too many assignments in one batch (max ${MAX_BULK_ASSIGNMENTS}).`,
    };
  }

  // Pre-load this account's users so we can validate owner IDs against the
  // tenant boundary in a single query.
  const accountUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.accountId, account.id));
  const accountUserIds = new Set(accountUsers.map((u) => u.id));

  // Pre-load the subscriptions we're touching so a cross-account row in
  // the request can be rejected before we issue any UPDATE. Defense in
  // depth — updateSubscription scopes by accountId too, but this lets us
  // surface "not yours" failures cleanly in the response.
  const subscriptionIds = input.assignments.map((a) => a.subscriptionId);
  const allowedSubs = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.accountId, account.id));
  const allowedSubIds = new Set(
    allowedSubs
      .filter((s) => subscriptionIds.includes(s.id))
      .map((s) => s.id)
  );

  const failures: Array<{ subscriptionId: string; error: string }> = [];
  let updated = 0;

  for (const { subscriptionId, ownerUserId } of input.assignments) {
    if (!allowedSubIds.has(subscriptionId)) {
      failures.push({
        subscriptionId,
        error: "Subscription not found in this account",
      });
      continue;
    }
    if (ownerUserId !== null && !accountUserIds.has(ownerUserId)) {
      failures.push({
        subscriptionId,
        error: "Owner must be a member of this account",
      });
      continue;
    }

    try {
      await updateSubscription({
        accountId: account.id,
        subscriptionId,
        actorUserId: user.id,
        patch: { ownerUserId },
      });
      updated++;
    } catch (err) {
      failures.push({
        subscriptionId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");

  return {
    ok: true,
    updated,
    failed: failures.length,
    failures,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// T4.15 — Undo an import.
//
// Soft-deletes (status='cancelled') every subscription created by a batch
// within a 24h window. After 24h the button disappears and the rows are
// considered "settled" — the user has had time to act on them and any
// edits/decisions recorded against them shouldn't be silently reverted.
//
// We use status='cancelled' because hard deleting would violate the
// "never delete" architecture and would break audit-log foreign keys.
// The cancelled status hides them from every "active" query (KPIs,
// alerts, action queue) — same effective behavior as delete.
// ─────────────────────────────────────────────────────────────────────────

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export type UndoImportResult =
  | { ok: true; undoneCount: number }
  | { ok: false; formError: string };

export async function undoImportBatchAction(
  importBatchId: string
): Promise<UndoImportResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  const [batch] = await db
    .select()
    .from(importBatchesTable)
    .where(eq(importBatchesTable.id, importBatchId));

  if (!batch || batch.accountId !== account.id) {
    return { ok: false, formError: "Import batch not found." };
  }

  if (batch.undoneAt) {
    return {
      ok: false,
      formError: "This import has already been undone.",
    };
  }

  const ageMs = Date.now() - batch.createdAt.getTime();
  if (ageMs > UNDO_WINDOW_MS) {
    return {
      ok: false,
      formError:
        "Undo is only available within 24 hours of an import. Cancel rows individually instead.",
    };
  }

  const subscriptionIds = batch.subscriptionIdsJson ?? [];
  if (!Array.isArray(subscriptionIds) || subscriptionIds.length === 0) {
    return { ok: true, undoneCount: 0 };
  }

  // Soft-delete the batch's rows inside a single transaction so partial
  // undo never happens. The audit log gets one cancelled entry per row
  // (consistent with the existing soft-delete pattern) PLUS a single
  // batch-level "import.undone" entry so the activity log reads
  // naturally.
  let undoneCount = 0;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, account.id),
          inArray(subscriptionsTable.id, subscriptionIds)
        )
      );

    for (const row of rows) {
      // Skip rows that have already been cancelled or otherwise moved
      // out of `active` — undo shouldn't bulldoze a manual decision the
      // user already made.
      if (row.status !== "active" && row.status !== "draft") continue;

      await tx
        .update(subscriptionsTable)
        .set({ status: "cancelled" })
        .where(eq(subscriptionsTable.id, row.id));

      await writeAuditLog(tx, {
        accountId: account.id,
        actorUserId: user.id,
        action: AUDIT_ACTIONS.subscriptionCancelled,
        target: { entityType: "subscription", entityId: row.id },
        before: { status: row.status },
        after: { status: "cancelled", reason: "import_undone" },
      });

      undoneCount++;
    }

    await tx
      .update(importBatchesTable)
      .set({ undoneAt: new Date(), undoneByUserId: user.id })
      .where(eq(importBatchesTable.id, importBatchId));
  });

  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/action-queue");

  return { ok: true, undoneCount };
}
