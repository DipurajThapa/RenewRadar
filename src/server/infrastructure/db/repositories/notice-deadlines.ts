import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";

// ─── Types ─────────────────────────────────────────────────────────────────

export type NoticeDeadlineRange = 30 | 90 | 365;

export type NoticeDeadlineStatus =
  | "all"
  | "action_needed"
  | "notice_window"
  | "upcoming"
  | "missed";

export type NoticeDeadlineFilter = {
  range: NoticeDeadlineRange;
  status: NoticeDeadlineStatus;
};

export type NoticeDeadlineRow = {
  renewalEventId: string;
  subscriptionId: string;
  vendorName: string;
  productName: string;
  planName: string | null;
  noticeDeadline: string;
  renewalDate: string;
  status: string;
  annualValueCents: number;
  autoRenew: boolean;
};

export type NoticeDeadlineKpis = {
  actionNeededIn7Days: number;
  inNoticeWindow: number;
  inNoticeWindowValueCents: number;
  upcomingNext90: number;
  upcomingNext90ValueCents: number;
  missedYtd: number;
  missedYtdValueCents: number;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().split("T")[0]!;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}

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

// ─── Queries ───────────────────────────────────────────────────────────────

export async function listNoticeDeadlines(
  accountId: string,
  filter: NoticeDeadlineFilter
): Promise<NoticeDeadlineRow[]> {
  const today = todayUtc();
  const cutoff = addDays(today, filter.range);

  const conditions = [
    eq(renewalEventsTable.accountId, accountId),
    eq(subscriptionsTable.status, "active"),
  ];

  if (filter.status === "missed") {
    conditions.push(eq(renewalEventsTable.status, "missed"));
    conditions.push(
      gte(renewalEventsTable.noticeDeadline, addDays(today, -180))
    );
  } else {
    conditions.push(gte(renewalEventsTable.noticeDeadline, today));
    conditions.push(lte(renewalEventsTable.noticeDeadline, cutoff));

    if (filter.status === "all") {
      conditions.push(
        inArray(renewalEventsTable.status, [
          "upcoming",
          "notice_window",
          "action_needed",
        ])
      );
    } else {
      conditions.push(eq(renewalEventsTable.status, filter.status));
    }
  }

  return db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      planName: subscriptionsTable.planName,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      renewalDate: renewalEventsTable.renewalDate,
      status: renewalEventsTable.status,
      autoRenew: subscriptionsTable.autoRenew,
      annualValueCents: annualValueCentsSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(and(...conditions))
    .orderBy(asc(renewalEventsTable.noticeDeadline));
}

export async function getNoticeDeadlineKpis(
  accountId: string
): Promise<NoticeDeadlineKpis> {
  const today = todayUtc();
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const in7 = addDays(today, 7);
  const in90 = addDays(today, 90);

  const [actionToday, noticeWindow, upcoming90, missedYtd] = await Promise.all([
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
          gte(renewalEventsTable.noticeDeadline, today),
          lte(renewalEventsTable.noticeDeadline, in7)
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
          inArray(renewalEventsTable.status, [
            "notice_window",
            "action_needed",
          ]),
          gte(renewalEventsTable.noticeDeadline, today)
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
          gte(renewalEventsTable.noticeDeadline, today),
          lte(renewalEventsTable.noticeDeadline, in90)
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
          eq(renewalEventsTable.status, "missed"),
          gte(renewalEventsTable.noticeDeadline, yearStart)
        )
      ),
  ]);

  return {
    actionNeededIn7Days: actionToday[0]?.count ?? 0,
    inNoticeWindow: noticeWindow[0]?.count ?? 0,
    inNoticeWindowValueCents: noticeWindow[0]?.valueCents ?? 0,
    upcomingNext90: upcoming90[0]?.count ?? 0,
    upcomingNext90ValueCents: upcoming90[0]?.valueCents ?? 0,
    missedYtd: missedYtd[0]?.count ?? 0,
    missedYtdValueCents: missedYtd[0]?.valueCents ?? 0,
  };
}
