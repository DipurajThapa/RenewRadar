/**
 * A2 — reconcile a projected saving against ACTUAL post-renewal spend (the ROI
 * loop / retention moat). For a savings record whose realization date has
 * passed, look at the confirmed recurring charge linked to its subscription: if
 * a post-renewal charge has been observed, compute the realized saving and mark
 * the record realized | variance. If nothing's been observed yet, leave it
 * pending so the cron retries.
 *
 * The lock (savings_record.lockedAt) protects the PROJECTED columns; this writes
 * only the realized-* columns + reconciledAt + status, so a locked historical
 * row is still reconciled additively.
 *
 * [C4] Reads run before the write transaction (getConfirmedChargeForSubscription
 * issues top-level db reads); the update + audit + vendor_event commit in one tx.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  savingsRecordsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import { getConfirmedChargeForSubscription } from "@server/infrastructure/db/repositories/spend";
import { annualizeCents } from "@server/domain/billing/annualize";
import {
  classifyReconciliation,
  type ReconciliationStatus,
} from "@server/domain/savings/reconcile";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "savings.reconcile" });

export class SavingsReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavingsReconcileError";
  }
}

export type ReconcileSavingsResult = {
  status: ReconciliationStatus;
  /** Optional clarifier — set when status='not_observed' for a known reason
   *  (e.g. the observed charge is in a non-USD currency we can't realize). */
  reason?: "non_usd_charge";
};

export async function reconcileSavingsRecord(input: {
  accountId: string;
  savingsRecordId: string;
  now?: Date;
}): Promise<ReconcileSavingsResult> {
  const now = input.now ?? new Date();

  const [record] = await db
    .select()
    .from(savingsRecordsTable)
    .where(
      and(
        eq(savingsRecordsTable.id, input.savingsRecordId),
        eq(savingsRecordsTable.accountId, input.accountId)
      )
    )
    .limit(1);
  if (!record) {
    throw new SavingsReconcileError("Savings record not found in this account.");
  }
  // Idempotent: once reconciled, never re-touch (a second cron pass is a no-op).
  if (record.reconciledAt) {
    return {
      status: (record.reconciliationStatus as ReconciliationStatus) ?? "realized",
    };
  }

  const charge = await getConfirmedChargeForSubscription(
    input.accountId,
    record.subscriptionId
  );
  // A post-renewal charge exists if a confirmed USD charge's most recent
  // observation is on/after the decision date (record.createdAt).
  const boundary = record.createdAt.toISOString().slice(0, 10);
  const hasDatedCharge = charge != null && charge.lastChargedOn >= boundary;
  const observed = hasDatedCharge && charge!.currency === "USD";

  if (!observed) {
    // Two ways to land here:
    //  (a) no post-renewal charge has shown up yet  → leave pending, retry.
    //  (b) a charge exists but its currency isn't USD → savings_record stores
    //      USD-typed cents, so we can't realize this without FX conversion.
    //      Record it as `not_observed` with a clear note instead of silently
    //      retrying forever; the user sees "awaiting reconciliation —
    //      non-USD charge" instead of an indefinite "pending."
    if (hasDatedCharge && charge!.currency !== "USD") {
      await db
        .update(savingsRecordsTable)
        .set({
          reconciliationStatus: "not_observed",
          reconciledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(savingsRecordsTable.id, input.savingsRecordId));
      return { status: "not_observed", reason: "non_usd_charge" } as const;
    }
    return { status: "not_observed" };
  }

  const realizedNewAnnualUsdCents = annualizeCents(
    charge!.latestAmountCents,
    charge!.detectedCycle
  );
  const realizedSavedAnnualUsdCents = Math.max(
    0,
    record.baselineAnnualUsdCents - realizedNewAnnualUsdCents
  );
  const status = classifyReconciliation({
    baselineAnnualUsdCents: record.baselineAnnualUsdCents,
    projectedSavedAnnualUsdCents: record.savedAnnualUsdCents,
    realizedSavedAnnualUsdCents,
  });

  await db.transaction(async (tx) => {
    // Only the realized-* columns + reconciliation fields — projected columns
    // (and a lock) are untouched.
    await tx
      .update(savingsRecordsTable)
      .set({
        realizedNewAnnualUsdCents,
        realizedSavedAnnualUsdCents,
        reconciledAt: now,
        reconciliationStatus: status,
      })
      .where(
        and(
          eq(savingsRecordsTable.id, record.id),
          eq(savingsRecordsTable.accountId, input.accountId)
        )
      );

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: null, // system cron
      action: AUDIT_ACTIONS.savingsRecordReconciled,
      target: { entityType: "savings_record", entityId: record.id },
      after: {
        status,
        projectedSavedAnnualUsdCents: record.savedAnnualUsdCents,
        realizedSavedAnnualUsdCents,
      },
    });

    const [sub] = await tx
      .select({ vendorId: subscriptionsTable.vendorId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, record.subscriptionId))
      .limit(1);
    if (sub) {
      await recordVendorEvent(tx, {
        accountId: input.accountId,
        vendorId: sub.vendorId,
        subscriptionId: record.subscriptionId,
        kind: "savings_realized",
        actorUserId: null,
        relatedEntityType: "savings_record",
        relatedEntityId: record.id,
        payload: {
          projectedSavedAnnualUsdCents: record.savedAnnualUsdCents,
          realizedSavedAnnualUsdCents,
          status,
        },
      });
    }
  });

  log.info("savings reconciled", {
    savingsRecordId: record.id,
    status,
    realizedSavedAnnualUsdCents,
  });
  return { status };
}
