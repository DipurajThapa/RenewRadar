import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  savingsRecordsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import type { SavingsKind } from "@server/infrastructure/db/schema";
import { annualizeCents } from "@server/domain/billing/annualize";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";

/**
 * Derive how much was saved (annualized cents) from a renewal decision.
 *
 * Conventions:
 *   - cancelled → newAnnual = 0; saved = baseline.
 *   - downgraded / renewed_with_adjustments → new = adjustedSeat × adjustedPrice
 *     normalized to annual. If adjusted values are missing or non-positive,
 *     fall back to the baseline (saved = 0).
 *   - renegotiated is the "general purpose" kind for explicit user input — the
 *     caller passes baseline + new directly.
 *
 * Negative savings (a *worse* outcome) are clamped to 0. We don't surface
 * "negative savings" because (a) it's confusing and (b) a higher-cost renewal
 * is captured by the regular subscription record, not the savings ledger.
 */
export function deriveSavings(input: {
  kind: SavingsKind;
  baselineAnnualUsdCents: number;
  newAnnualUsdCents?: number;
}): { newAnnualUsdCents: number; savedAnnualUsdCents: number } {
  const baseline = Math.max(0, input.baselineAnnualUsdCents);
  let newAnnual: number;
  if (input.kind === "cancelled") {
    newAnnual = 0;
  } else if (input.newAnnualUsdCents !== undefined) {
    newAnnual = Math.max(0, input.newAnnualUsdCents);
  } else {
    newAnnual = baseline;
  }
  const saved = Math.max(0, baseline - newAnnual);
  return { newAnnualUsdCents: newAnnual, savedAnnualUsdCents: saved };
}

/**
 * Upsert a savings record for a renewal-event decision.
 *
 * Idempotent: the unique constraint on `renewal_event_id` means re-running
 * the decision overwrites the prior record (unless it's already locked —
 * in which case the caller is expected to skip).
 */
export async function upsertSavingsRecordFromDecision(input: {
  accountId: string;
  actorUserId: string;
  renewalEventId: string;
  subscriptionId: string;
  kind: SavingsKind;
  baselineAnnualUsdCents: number;
  newAnnualUsdCents?: number;
  note?: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const { newAnnualUsdCents, savedAnnualUsdCents } = deriveSavings(input);

    const [existing] = await tx
      .select()
      .from(savingsRecordsTable)
      .where(
        and(
          eq(savingsRecordsTable.accountId, input.accountId),
          eq(savingsRecordsTable.renewalEventId, input.renewalEventId)
        )
      )
      .limit(1);

    if (existing?.lockedAt) {
      // Locked rows are immutable — don't overwrite, don't fail.
      return;
    }

    if (existing) {
      const [updated] = await tx
        .update(savingsRecordsTable)
        .set({
          kind: input.kind,
          baselineAnnualUsdCents: input.baselineAnnualUsdCents,
          newAnnualUsdCents,
          savedAnnualUsdCents,
          note: input.note ?? existing.note,
        })
        .where(eq(savingsRecordsTable.id, existing.id))
        .returning();

      await writeAuditLog(tx, {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.savingsRecordUpdated,
        target: { entityType: "savings_record", entityId: existing.id },
        before: existing as unknown as Record<string, unknown>,
        after: (updated ?? existing) as unknown as Record<string, unknown>,
      });
    } else {
      const [created] = await tx
        .insert(savingsRecordsTable)
        .values({
          accountId: input.accountId,
          renewalEventId: input.renewalEventId,
          subscriptionId: input.subscriptionId,
          kind: input.kind,
          baselineAnnualUsdCents: input.baselineAnnualUsdCents,
          newAnnualUsdCents,
          savedAnnualUsdCents,
          note: input.note ?? null,
        })
        .returning();
      if (!created) throw new Error("Failed to insert savings record");

      await writeAuditLog(tx, {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.savingsRecordCreated,
        target: { entityType: "savings_record", entityId: created.id },
        after: created as unknown as Record<string, unknown>,
      });

      // Vendor memory — record savings so the per-vendor intelligence view
      // can show "you've saved $X with this vendor over the last 3 years."
      const [sub] = await tx
        .select({ vendorId: subscriptionsTable.vendorId })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, input.subscriptionId))
        .limit(1);
      if (sub) {
        await recordVendorEvent(tx, {
          accountId: input.accountId,
          vendorId: sub.vendorId,
          subscriptionId: input.subscriptionId,
          kind: "savings_recorded",
          payload: {
            kind: input.kind,
            baselineAnnualUsdCents: input.baselineAnnualUsdCents,
            newAnnualUsdCents,
            savedAnnualUsdCents,
          },
          actorUserId: input.actorUserId,
          relatedEntityType: "savings_record",
          relatedEntityId: created.id,
        });
      }
    }
  });
}

/**
 * Helper: compute the baseline (current annualized) from a subscription row
 * loaded inside the same transaction. Use this from the decide-now action so
 * the savings calculation doesn't depend on a separate fetch.
 */
export function annualizedFromSubscription(sub: {
  totalCostPerPeriodCents: number;
  billingCycle: string;
}): number {
  return annualizeCents(sub.totalCostPerPeriodCents, sub.billingCycle);
}

/**
 * Re-export so callers don't need to import the table directly.
 */
export { subscriptionsTable };
