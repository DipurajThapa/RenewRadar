/**
 * Wedge PoC — run the pure detector over an account's ingested transactions
 * and upsert the resulting SUGGESTIONS into recurring_charge.
 *
 * Cron-safe upsert: ON CONFLICT targets the PARTIAL unique index
 * (connectionId, normalizedMerchant, detectedCycle) WHERE status='detected',
 * so a re-run UPDATES the open suggestion instead of stacking duplicates.
 *
 * AUDIT-EXEMPT: derived suggestion data (parallel to ai_extracted_field). The
 * audited moment is the human confirm in reconcile.ts. Uses tx.* deliberately.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  recurringChargesTable,
  spendTransactionsTable,
} from "@server/infrastructure/db/schema";
import { listSpendTransactionsForDetection } from "@server/infrastructure/db/repositories/spend";
import {
  detectRecurringCharges,
  type DetectorTransaction,
} from "@server/domain/spend/detect-recurring";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "spend.detect" });

export type DetectResult = { detected: number };

export async function detectRecurringForConnection(input: {
  accountId: string;
  connectionId: string;
}): Promise<DetectResult> {
  const txns = await listSpendTransactionsForDetection(
    input.accountId,
    input.connectionId
  );
  const detectorInput: DetectorTransaction[] = txns.map((t) => ({
    normalizedMerchant: t.normalizedMerchant,
    currency: t.currency,
    amountCents: t.amountCents,
    chargedOn: t.chargedOn,
    mcc: t.mcc,
  }));

  const candidates = detectRecurringCharges(detectorInput);
  if (candidates.length === 0) return { detected: 0 };

  const detectedMerchants = new Set(candidates.map((c) => c.normalizedMerchant));

  await db.transaction(async (tx) => {
    for (const c of candidates) {
      await tx
        .insert(recurringChargesTable)
        .values({
          accountId: input.accountId,
          connectionId: input.connectionId,
          normalizedMerchant: c.normalizedMerchant,
          currency: c.currency,
          suggestedVendorName: c.suggestedVendorName,
          detectedCycle: c.detectedCycle,
          typicalAmountCents: c.typicalAmountCents,
          latestAmountCents: c.latestAmountCents,
          amountDriftPct: c.amountDriftPct,
          confidence: c.confidence,
          sampleSize: c.sampleSize,
          needsManualConfirm: c.needsManualConfirm,
          firstChargedOn: c.firstChargedOn,
          lastChargedOn: c.lastChargedOn,
          projectedNextChargeOn: c.projectedNextChargeOn,
          status: "detected",
        })
        .onConflictDoUpdate({
          target: [
            recurringChargesTable.connectionId,
            recurringChargesTable.normalizedMerchant,
            recurringChargesTable.currency,
            recurringChargesTable.detectedCycle,
          ],
          targetWhere: sql`status = 'detected'`,
          set: {
            currency: c.currency,
            suggestedVendorName: c.suggestedVendorName,
            typicalAmountCents: c.typicalAmountCents,
            latestAmountCents: c.latestAmountCents,
            amountDriftPct: c.amountDriftPct,
            confidence: c.confidence,
            sampleSize: c.sampleSize,
            needsManualConfirm: c.needsManualConfirm,
            firstChargedOn: c.firstChargedOn,
            lastChargedOn: c.lastChargedOn,
            projectedNextChargeOn: c.projectedNextChargeOn,
            updatedAt: new Date(),
          },
        });
    }

    // Mark the transactions backing detected merchants as grouped.
    if (detectedMerchants.size > 0) {
      await tx
        .update(spendTransactionsTable)
        .set({ status: "grouped" })
        .where(
          and(
            eq(spendTransactionsTable.connectionId, input.connectionId),
            inArray(
              spendTransactionsTable.normalizedMerchant,
              Array.from(detectedMerchants)
            )
          )
        );
    }
  });

  log.info("recurring charges detected", {
    connectionId: input.connectionId,
    detected: candidates.length,
  });
  return { detected: candidates.length };
}
