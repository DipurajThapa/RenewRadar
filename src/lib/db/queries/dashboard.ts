import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogTable,
  renewalEventsTable,
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@/lib/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().split("T")[0]!;
}

function addDaysToString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}

// Annualized cents — used in several SQL expressions
function annualValueCentsSql() {
  return sql<number>`
    case
      when ${subscriptionsTable.billingCycle} = 'monthly'
        then ${subscriptionsTable.totalCostPerPeriodCents} * 12
      when ${subscriptionsTable.billingCycle} = 'quarterly'
        then ${subscriptionsTable.totalCostPerPeriodCents} * 4
      else ${subscriptionsTable.totalCostPerPeriodCents}
    end
  `;
}

function annualValueSumSql() {
  return sql<number>`
    coalesce(
      sum(
        case
          when ${subscriptionsTable.billingCycle} = 'monthly'
            then ${subscriptionsTable.totalCostPerPeriodCents} * 12
          when ${subscriptionsTable.billingCycle} = 'quarterly'
            then ${subscriptionsTable.totalCostPerPeriodCents} * 4
          else ${subscriptionsTable.totalCostPerPeriodCents}
        end
      ),
      0
    )::int
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action band counts
// ─────────────────────────────────────────────────────────────────────────────

export type ActionBandCounts = {
  noticeDeadlinesActionWindow: number;
  renewalsAwaitingDecision: number;
  reclamationInactiveSeats: number; // V1.5 — always 0 in V1
};

export async function getActionBandCounts(
  accountId: string
): Promise<ActionBandCounts> {
  const today = todayUtc();
  const in7 = addDaysToString(today, 7);
  const in90 = addDaysToString(today, 90);

  const [noticeAction, renewalDecisions] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(renewalEventsTable)
      .innerJoin(
        subscriptionsTable,
        eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
      )
      .where(
        and(
          eq(renewalEventsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          inArray(renewalEventsTable.status, [
            "notice_window",
            "action_needed",
          ]),
          lte(renewalEventsTable.noticeDeadline, in7),
          gte(renewalEventsTable.noticeDeadline, today)
        )
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(renewalEventsTable)
      .innerJoin(
        subscriptionsTable,
        eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
      )
      .where(
        and(
          eq(renewalEventsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          inArray(renewalEventsTable.status, [
            "upcoming",
            "notice_window",
            "action_needed",
          ]),
          lte(renewalEventsTable.renewalDate, in90),
          isNull(renewalEventsTable.decision)
        )
      ),
  ]);

  return {
    noticeDeadlinesActionWindow: noticeAction[0]?.count ?? 0,
    renewalsAwaitingDecision: renewalDecisions[0]?.count ?? 0,
    reclamationInactiveSeats: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI strip
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardKpis = {
  trackedSubscriptions: number;
  trackedSubscriptionsAddedThisMonth: number;
  noticeDeadlinesNext30Count: number;
  noticeDeadlinesNext30ValueCents: number;
  totalAnnualSpendCents: number;
};

export async function getDashboardKpis(
  accountId: string
): Promise<DashboardKpis> {
  const today = todayUtc();
  const in30 = addDaysToString(today, 30);

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [tracked, addedThisMonth, deadlines, totalSpend] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active")
        )
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, accountId),
          gte(subscriptionsTable.createdAt, startOfMonth)
        )
      ),

    db
      .select({
        count: sql<number>`count(*)::int`,
        valueCents: annualValueSumSql(),
      })
      .from(renewalEventsTable)
      .innerJoin(
        subscriptionsTable,
        eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
      )
      .where(
        and(
          eq(renewalEventsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          eq(subscriptionsTable.autoRenew, true),
          gte(renewalEventsTable.noticeDeadline, today),
          lte(renewalEventsTable.noticeDeadline, in30)
        )
      ),

    db
      .select({ valueCents: annualValueSumSql() })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active")
        )
      ),
  ]);

  return {
    trackedSubscriptions: tracked[0]?.count ?? 0,
    trackedSubscriptionsAddedThisMonth: addedThisMonth[0]?.count ?? 0,
    noticeDeadlinesNext30Count: deadlines[0]?.count ?? 0,
    noticeDeadlinesNext30ValueCents: deadlines[0]?.valueCents ?? 0,
    totalAnnualSpendCents: totalSpend[0]?.valueCents ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notice Deadline Spotlight
// ─────────────────────────────────────────────────────────────────────────────

export type SpotlightRow = {
  renewalEventId: string;
  subscriptionId: string;
  vendorName: string;
  productName: string;
  noticeDeadline: string;
  annualValueCents: number;
  status: string;
};

export async function getNoticeDeadlineSpotlight(
  accountId: string,
  limit = 5
): Promise<SpotlightRow[]> {
  const today = todayUtc();

  return db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      status: renewalEventsTable.status,
      annualValueCents: annualValueCentsSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active"),
        gte(renewalEventsTable.noticeDeadline, today),
        inArray(renewalEventsTable.status, [
          "upcoming",
          "notice_window",
          "action_needed",
        ])
      )
    )
    .orderBy(asc(renewalEventsTable.noticeDeadline))
    .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Renewal Calendar Snapshot
// ─────────────────────────────────────────────────────────────────────────────

export type MonthBucket = {
  monthKey: string; // YYYY-MM
  count: number;
  totalValueCents: number;
};

export async function getRenewalCalendarSnapshot(
  accountId: string
): Promise<{ monthBuckets: MonthBucket[]; topThree: SpotlightRow[] }> {
  const today = todayUtc();
  const oneYearOut = addDaysToString(today, 365);

  const monthsRaw = await db
    .select({
      monthKey: sql<string>`to_char(${renewalEventsTable.renewalDate}::date, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      totalValueCents: annualValueSumSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active"),
        gte(renewalEventsTable.renewalDate, today),
        lte(renewalEventsTable.renewalDate, oneYearOut)
      )
    )
    .groupBy(sql`to_char(${renewalEventsTable.renewalDate}::date, 'YYYY-MM')`)
    .orderBy(sql`to_char(${renewalEventsTable.renewalDate}::date, 'YYYY-MM')`);

  const topThree = await db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      status: renewalEventsTable.status,
      annualValueCents: annualValueCentsSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active"),
        gte(renewalEventsTable.renewalDate, today)
      )
    )
    .orderBy(asc(renewalEventsTable.renewalDate))
    .limit(3);

  return { monthBuckets: monthsRaw, topThree };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomalies
// ─────────────────────────────────────────────────────────────────────────────

export type Anomaly =
  | { type: "auto_renew_no_decision"; count: number }
  | { type: "default_notice_period"; count: number };

export async function getAnomalies(accountId: string): Promise<Anomaly[]> {
  const today = todayUtc();
  const in30 = addDaysToString(today, 30);

  const [autoRenewMissing, defaultNoticeUsed] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(renewalEventsTable)
      .innerJoin(
        subscriptionsTable,
        eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
      )
      .where(
        and(
          eq(renewalEventsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          eq(subscriptionsTable.autoRenew, true),
          gte(renewalEventsTable.noticeDeadline, today),
          lte(renewalEventsTable.noticeDeadline, in30),
          isNull(renewalEventsTable.decision)
        )
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          eq(subscriptionsTable.noticePeriodDays, 30)
        )
      ),
  ]);

  const anomalies: Anomaly[] = [];
  if ((autoRenewMissing[0]?.count ?? 0) > 0) {
    anomalies.push({
      type: "auto_renew_no_decision",
      count: autoRenewMissing[0]!.count,
    });
  }
  if ((defaultNoticeUsed[0]?.count ?? 0) > 0) {
    anomalies.push({
      type: "default_notice_period",
      count: defaultNoticeUsed[0]!.count,
    });
  }
  return anomalies;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent Activity
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityEntry = {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  createdAt: Date;
};

export async function getRecentActivity(
  accountId: string,
  limit = 8
): Promise<ActivityEntry[]> {
  return db
    .select({
      id: auditLogTable.id,
      actorName: usersTable.fullName,
      actorEmail: usersTable.workEmail,
      action: auditLogTable.action,
      targetEntityType: auditLogTable.targetEntityType,
      targetEntityId: auditLogTable.targetEntityId,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.actorUserId, usersTable.id))
    .where(eq(auditLogTable.accountId, accountId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Audit Log (paginated)
// ─────────────────────────────────────────────────────────────────────────────

export type AuditLogEntry = {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
};

export type AuditLogFilter = {
  entityType?: string;
  /** Cursor: return entries strictly older than this createdAt. */
  cursor?: Date;
  limit?: number;
};

/**
 * Paginated audit log query for the /settings/audit viewer.
 *
 * Returns one page of entries scoped to the account, filterable by entity
 * type. Pagination uses a `createdAt < cursor` keyset rather than offset —
 * cheap on a (accountId, createdAt) index and stable when new rows land
 * mid-pagination.
 */
export async function listAuditEntries(
  accountId: string,
  filter: AuditLogFilter = {}
): Promise<AuditLogEntry[]> {
  const limit = Math.min(filter.limit ?? 50, 200);

  const conditions = [eq(auditLogTable.accountId, accountId)];
  if (filter.entityType) {
    conditions.push(eq(auditLogTable.targetEntityType, filter.entityType));
  }
  if (filter.cursor) {
    conditions.push(sql`${auditLogTable.createdAt} < ${filter.cursor}`);
  }

  return db
    .select({
      id: auditLogTable.id,
      actorName: usersTable.fullName,
      actorEmail: usersTable.workEmail,
      action: auditLogTable.action,
      targetEntityType: auditLogTable.targetEntityType,
      targetEntityId: auditLogTable.targetEntityId,
      before: auditLogTable.before,
      after: auditLogTable.after,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.actorUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
}

/**
 * Distinct entity types observed in the audit log for an account, used to
 * populate the filter dropdown. Cheap (DISTINCT on a small column).
 */
export async function listAuditEntityTypes(
  accountId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ entityType: auditLogTable.targetEntityType })
    .from(auditLogTable)
    .where(eq(auditLogTable.accountId, accountId));
  return rows
    .map((r) => r.entityType)
    .filter((v): v is string => typeof v === "string");
}
