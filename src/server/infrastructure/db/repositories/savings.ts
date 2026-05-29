import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  decisionContextsTable,
  savingsRecordsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type { SavingsRecord } from "@server/infrastructure/db/schema";

export type SavingsRow = SavingsRecord & {
  vendorName: string;
  productName: string;
  /** True if the row is older than 30 days OR explicitly locked. */
  isLocked: boolean;
  /** Rationale codes pulled from the linked decision_context, if any. */
  rationaleCodes: string[];
  /** Negotiation lever from the linked decision_context, if any. */
  negotiationLever: string | null;
};

const LOCK_AFTER_DAYS = 30;

function deriveIsLocked(record: { lockedAt: Date | null; createdAt: Date }): boolean {
  if (record.lockedAt) return true;
  const ageDays =
    (Date.now() - record.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > LOCK_AFTER_DAYS;
}

/**
 * One savings row per renewal event (the schema unique constraint enforces it).
 * Returns null if the user hasn't logged a decision that produces savings.
 */
export async function getSavingsForRenewalEvent(
  accountId: string,
  renewalEventId: string
): Promise<SavingsRow | null> {
  const rows = await db
    .select({
      record: savingsRecordsTable,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      rationaleCodesJson: decisionContextsTable.rationaleCodesJson,
      negotiationLever: decisionContextsTable.negotiationLever,
    })
    .from(savingsRecordsTable)
    .innerJoin(
      subscriptionsTable,
      eq(savingsRecordsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .leftJoin(
      decisionContextsTable,
      eq(
        decisionContextsTable.renewalEventId,
        savingsRecordsTable.renewalEventId
      )
    )
    .where(
      and(
        eq(savingsRecordsTable.accountId, accountId),
        eq(savingsRecordsTable.renewalEventId, renewalEventId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row.record,
    vendorName: row.vendorName,
    productName: row.productName,
    isLocked: deriveIsLocked(row.record),
    rationaleCodes: parseRationaleCodes(row.rationaleCodesJson),
    negotiationLever:
      row.negotiationLever && row.negotiationLever !== "none"
        ? row.negotiationLever
        : null,
  };
}

export async function listSavingsForAccount(
  accountId: string,
  options: { sinceDate?: Date; limit?: number } = {}
): Promise<SavingsRow[]> {
  const conditions = [eq(savingsRecordsTable.accountId, accountId)];
  if (options.sinceDate) {
    conditions.push(gte(savingsRecordsTable.createdAt, options.sinceDate));
  }

  const rows = await db
    .select({
      record: savingsRecordsTable,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      rationaleCodesJson: decisionContextsTable.rationaleCodesJson,
      negotiationLever: decisionContextsTable.negotiationLever,
    })
    .from(savingsRecordsTable)
    .innerJoin(
      subscriptionsTable,
      eq(savingsRecordsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    // Left join so savings rows without a captured rationale still surface.
    .leftJoin(
      decisionContextsTable,
      eq(
        decisionContextsTable.renewalEventId,
        savingsRecordsTable.renewalEventId
      )
    )
    .where(and(...conditions))
    .orderBy(desc(savingsRecordsTable.createdAt))
    .limit(options.limit ?? 200);

  return rows.map((r) => ({
    ...r.record,
    vendorName: r.vendorName,
    productName: r.productName,
    isLocked: deriveIsLocked(r.record),
    rationaleCodes: parseRationaleCodes(r.rationaleCodesJson),
    negotiationLever:
      r.negotiationLever && r.negotiationLever !== "none"
        ? r.negotiationLever
        : null,
  }));
}

/**
 * Defensive parser for the jsonb rationale array. The column is `notNull`
 * (defaulted to []), but the typed value reaches us as `unknown` — guard
 * against null/non-array shapes so the reports page can't crash on a
 * malformed row.
 */
function parseRationaleCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export type SavingsTotals = {
  totalSavedAnnualUsdCents: number;
  recordCount: number;
  byKind: Record<string, { count: number; savedAnnualUsdCents: number }>;
};

export async function getSavingsTotals(
  accountId: string,
  options: { sinceDate?: Date } = {}
): Promise<SavingsTotals> {
  const conditions = [eq(savingsRecordsTable.accountId, accountId)];
  if (options.sinceDate) {
    conditions.push(gte(savingsRecordsTable.createdAt, options.sinceDate));
  }

  const rows = await db
    .select({
      kind: savingsRecordsTable.kind,
      count: sql<number>`count(*)::int`,
      saved: sql<number>`coalesce(sum(${savingsRecordsTable.savedAnnualUsdCents}), 0)::int`,
    })
    .from(savingsRecordsTable)
    .where(and(...conditions))
    .groupBy(savingsRecordsTable.kind);

  let total = 0;
  let count = 0;
  const byKind: SavingsTotals["byKind"] = {};
  for (const row of rows) {
    byKind[row.kind] = {
      count: row.count,
      savedAnnualUsdCents: row.saved,
    };
    total += row.saved;
    count += row.count;
  }

  return {
    totalSavedAnnualUsdCents: total,
    recordCount: count,
    byKind,
  };
}

export type SavingsByMonthRow = {
  monthKey: string; // YYYY-MM
  count: number;
  savedAnnualUsdCents: number;
};

/**
 * Savings grouped by month — used by the Reports page for the YTD chart.
 */
export async function getSavingsByMonth(
  accountId: string,
  options: { sinceDate?: Date } = {}
): Promise<SavingsByMonthRow[]> {
  const conditions = [eq(savingsRecordsTable.accountId, accountId)];
  if (options.sinceDate) {
    conditions.push(gte(savingsRecordsTable.createdAt, options.sinceDate));
  }

  return db
    .select({
      monthKey: sql<string>`to_char(${savingsRecordsTable.createdAt}, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      savedAnnualUsdCents: sql<number>`coalesce(sum(${savingsRecordsTable.savedAnnualUsdCents}), 0)::int`,
    })
    .from(savingsRecordsTable)
    .where(and(...conditions))
    .groupBy(sql`to_char(${savingsRecordsTable.createdAt}, 'YYYY-MM')`)
    .orderBy(asc(sql`to_char(${savingsRecordsTable.createdAt}, 'YYYY-MM')`));
}

/**
 * CRON-ONLY cross-account read (A2): savings records whose realization date has
 * passed and that haven't been reconciled yet. Each row is re-scoped by its own
 * accountId in the reconcile use case. Returns ids only — the use case loads the
 * full row inside its own account scope.
 */
export async function listSavingsRecordsDueForReconciliation(
  now: Date
): Promise<Array<{ id: string; accountId: string }>> {
  return db
    .select({
      id: savingsRecordsTable.id,
      accountId: savingsRecordsTable.accountId,
    })
    .from(savingsRecordsTable)
    .where(
      and(
        lte(savingsRecordsTable.expectedSavingsRealizedAt, now),
        isNull(savingsRecordsTable.reconciledAt)
      )
    );
}

export type RealizedSavingsTotals = {
  projectedSavedAnnualUsdCents: number;
  realizedSavedAnnualUsdCents: number;
  reconciledCount: number;
  realizedCount: number;
  varianceCount: number;
  awaitingCount: number;
};

/**
 * Account-scoped roll-up for the reports "Realized vs projected" card: total
 * projected savings, total PROVEN (reconciled) savings, and counts by status.
 */
export async function getRealizedSavingsTotals(
  accountId: string
): Promise<RealizedSavingsTotals> {
  const [row] = await db
    .select({
      projected: sql<number>`coalesce(sum(${savingsRecordsTable.savedAnnualUsdCents}), 0)::int`,
      realized: sql<number>`coalesce(sum(${savingsRecordsTable.realizedSavedAnnualUsdCents}), 0)::int`,
      reconciledCount: sql<number>`count(*) filter (where ${savingsRecordsTable.reconciledAt} is not null)::int`,
      realizedCount: sql<number>`count(*) filter (where ${savingsRecordsTable.reconciliationStatus} = 'realized')::int`,
      varianceCount: sql<number>`count(*) filter (where ${savingsRecordsTable.reconciliationStatus} = 'variance')::int`,
      awaitingCount: sql<number>`count(*) filter (where ${savingsRecordsTable.reconciledAt} is null)::int`,
    })
    .from(savingsRecordsTable)
    .where(eq(savingsRecordsTable.accountId, accountId));
  return {
    projectedSavedAnnualUsdCents: row?.projected ?? 0,
    realizedSavedAnnualUsdCents: row?.realized ?? 0,
    reconciledCount: row?.reconciledCount ?? 0,
    realizedCount: row?.realizedCount ?? 0,
    varianceCount: row?.varianceCount ?? 0,
    awaitingCount: row?.awaitingCount ?? 0,
  };
}

