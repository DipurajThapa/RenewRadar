/**
 * Wedge PoC — spend ingestion read layer. Every account-scoped function takes
 * `accountId` first and filters on it (tenant-isolation fuse). The single
 * cross-account reader is explicitly named + commented for cron use only.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  recurringChargesTable,
  spendConnectionsTable,
  spendTransactionsTable,
  type RecurringCharge,
  type SpendConnection,
  type SpendTransaction,
} from "@server/infrastructure/db/schema";
import type { PlanTier } from "@server/domain/billing/tier-definitions";

export async function getSpendConnectionByKind(
  accountId: string,
  kind: "fixture" | "ramp"
): Promise<SpendConnection | null> {
  const [row] = await db
    .select()
    .from(spendConnectionsTable)
    .where(
      and(
        eq(spendConnectionsTable.accountId, accountId),
        eq(spendConnectionsTable.kind, kind)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function listSpendConnections(
  accountId: string
): Promise<SpendConnection[]> {
  return db
    .select()
    .from(spendConnectionsTable)
    .where(eq(spendConnectionsTable.accountId, accountId))
    .orderBy(desc(spendConnectionsTable.createdAt));
}

/**
 * CRON-ONLY cross-account read. The spend-sync job iterates every active
 * connection across all accounts; each iteration re-scopes by the row's own
 * accountId and builds a fresh connector (no shared state). Never call from a
 * request path.
 *
 * Joins the owning account's `planTier` so the cron can skip connections whose
 * plan no longer includes spend auto-discovery (e.g. a paid→free downgrade left
 * a connection row live) — otherwise it would keep ingesting for free (REV-5).
 */
export async function listAllActiveSpendConnectionsForCron(): Promise<
  Array<SpendConnection & { planTier: PlanTier }>
> {
  const rows = await db
    .select({ connection: spendConnectionsTable, planTier: accountsTable.planTier })
    .from(spendConnectionsTable)
    .innerJoin(accountsTable, eq(accountsTable.id, spendConnectionsTable.accountId))
    .where(eq(spendConnectionsTable.status, "active"));
  return rows.map((r) => ({ ...r.connection, planTier: r.planTier as PlanTier }));
}

export async function listSpendTransactionsForDetection(
  accountId: string,
  connectionId: string
): Promise<SpendTransaction[]> {
  return db
    .select()
    .from(spendTransactionsTable)
    .where(
      and(
        eq(spendTransactionsTable.accountId, accountId),
        eq(spendTransactionsTable.connectionId, connectionId)
      )
    );
}

/**
 * The recurring_charge that reconcile linked to a subscription (status
 * 'confirmed', subscriptionId set). accountId-first. The renewal brief uses it
 * to pull the REAL observed charge series for the price-trajectory reasoning —
 * this is what connects the ingestion half of the wedge to the reasoning half.
 */
export async function getConfirmedChargeForSubscription(
  accountId: string,
  subscriptionId: string
): Promise<RecurringCharge | null> {
  const [row] = await db
    .select()
    .from(recurringChargesTable)
    .where(
      and(
        eq(recurringChargesTable.accountId, accountId),
        eq(recurringChargesTable.subscriptionId, subscriptionId),
        eq(recurringChargesTable.status, "confirmed")
      )
    )
    .orderBy(desc(recurringChargesTable.reviewedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Positive (non-refund) spend transactions for a merchant+currency on a
 * connection, oldest→newest. accountId-first. Feeds the brief's trajectory with
 * the actual per-period charges behind a confirmed recurring charge.
 */
export async function listPositiveTransactionsForMerchant(
  accountId: string,
  connectionId: string,
  normalizedMerchant: string,
  currency: string
): Promise<SpendTransaction[]> {
  const rows = await db
    .select()
    .from(spendTransactionsTable)
    .where(
      and(
        eq(spendTransactionsTable.accountId, accountId),
        eq(spendTransactionsTable.connectionId, connectionId),
        eq(spendTransactionsTable.normalizedMerchant, normalizedMerchant),
        eq(spendTransactionsTable.currency, currency)
      )
    )
    .orderBy(asc(spendTransactionsTable.chargedOn));
  return rows.filter((r) => r.amountCents > 0);
}

export async function listDetectedRecurringCharges(
  accountId: string
): Promise<RecurringCharge[]> {
  return db
    .select()
    .from(recurringChargesTable)
    .where(
      and(
        eq(recurringChargesTable.accountId, accountId),
        eq(recurringChargesTable.status, "detected")
      )
    )
    .orderBy(desc(recurringChargesTable.confidence));
}

export async function getRecurringCharge(
  accountId: string,
  id: string
): Promise<RecurringCharge | null> {
  const [row] = await db
    .select()
    .from(recurringChargesTable)
    .where(
      and(
        eq(recurringChargesTable.id, id),
        eq(recurringChargesTable.accountId, accountId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function countDetectedRecurringCharges(
  accountId: string
): Promise<number> {
  const rows = await db
    .select({ id: recurringChargesTable.id })
    .from(recurringChargesTable)
    .where(
      and(
        eq(recurringChargesTable.accountId, accountId),
        eq(recurringChargesTable.status, "detected")
      )
    );
  return rows.length;
}
