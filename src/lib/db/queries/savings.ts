import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  vendorsTable,
} from "@/lib/db/schema";
import type { SavingsRecord } from "@/lib/db/schema";

export type SavingsRow = SavingsRecord & {
  vendorName: string;
  productName: string;
  /** True if the row is older than 30 days OR explicitly locked. */
  isLocked: boolean;
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
    })
    .from(savingsRecordsTable)
    .innerJoin(
      subscriptionsTable,
      eq(savingsRecordsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
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
    })
    .from(savingsRecordsTable)
    .innerJoin(
      subscriptionsTable,
      eq(savingsRecordsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(and(...conditions))
    .orderBy(desc(savingsRecordsTable.createdAt))
    .limit(options.limit ?? 200);

  return rows.map((r) => ({
    ...r.record,
    vendorName: r.vendorName,
    productName: r.productName,
    isLocked: deriveIsLocked(r.record),
  }));
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

// renewalEventsTable export referenced for the inline join in
// other modules — re-exported here for callers that import this file.
void renewalEventsTable;
