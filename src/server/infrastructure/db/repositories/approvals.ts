import { and, asc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalEventsTable,
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import { annualizeCents } from "@server/domain/billing/annualize";

export type PendingApprovalRow = {
  renewalEventId: string;
  subscriptionId: string;
  vendorName: string;
  productName: string;
  decision: string;
  decisionAt: Date | null;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedByEmail: string | null;
  noticeDeadline: string;
  annualValueCents: number;
};

/**
 * Renewal decisions that are awaiting a second-pair-of-eyes approval.
 *
 * Tenant-scoped + decided-by joined so the approval UI can show who's
 * waiting on whom. Sorted by notice deadline so the most urgent approvals
 * land at the top.
 */
export async function listPendingApprovals(
  accountId: string
): Promise<PendingApprovalRow[]> {
  const rows = await db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      decision: renewalEventsTable.decision,
      decisionAt: renewalEventsTable.decisionAt,
      decisionNote: renewalEventsTable.decisionNote,
      decidedByUserId: renewalEventsTable.decidedByUserId,
      decidedByName: usersTable.fullName,
      decidedByEmail: usersTable.workEmail,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      billingCycle: subscriptionsTable.billingCycle,
      totalCostPerPeriodCents: subscriptionsTable.totalCostPerPeriodCents,
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .leftJoin(
      usersTable,
      eq(renewalEventsTable.decidedByUserId, usersTable.id)
    )
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(renewalEventsTable.approvalStatus, "pending")
      )
    )
    .orderBy(asc(renewalEventsTable.noticeDeadline));

  return rows
    .filter((r): r is typeof r & { decision: string } => r.decision !== null)
    .map((r) => ({
      renewalEventId: r.renewalEventId,
      subscriptionId: r.subscriptionId,
      vendorName: r.vendorName,
      productName: r.productName,
      decision: r.decision,
      decisionAt: r.decisionAt,
      decisionNote: r.decisionNote,
      decidedByUserId: r.decidedByUserId,
      decidedByName: r.decidedByName,
      decidedByEmail: r.decidedByEmail,
      noticeDeadline: r.noticeDeadline,
      annualValueCents: annualizeCents(r.totalCostPerPeriodCents, r.billingCycle),
    }));
}

export async function countPendingApprovals(accountId: string): Promise<number> {
  const rows = await db
    .select({ id: renewalEventsTable.id })
    .from(renewalEventsTable)
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(renewalEventsTable.approvalStatus, "pending")
      )
    );
  return rows.length;
}
