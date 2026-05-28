import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  decisionContextsTable,
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  usersTable,
  vendorEventsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type {
  DecisionContext,
  Vendor,
  VendorEvent,
  VendorEventKind,
} from "@server/infrastructure/db/schema";

export type VendorEventRow = VendorEvent & {
  actorName: string | null;
  actorEmail: string | null;
};

/**
 * Full event timeline for one vendor, newest first.
 */
export async function listVendorEvents(
  accountId: string,
  vendorId: string,
  options: { limit?: number; kinds?: VendorEventKind[] } = {}
): Promise<VendorEventRow[]> {
  const conditions = [
    eq(vendorEventsTable.accountId, accountId),
    eq(vendorEventsTable.vendorId, vendorId),
  ];
  if (options.kinds && options.kinds.length > 0) {
    conditions.push(
      sql`${vendorEventsTable.kind} = ANY(${options.kinds})` as never
    );
  }

  const rows = await db
    .select({
      event: vendorEventsTable,
      actorName: usersTable.fullName,
      actorEmail: usersTable.workEmail,
    })
    .from(vendorEventsTable)
    .leftJoin(usersTable, eq(vendorEventsTable.actorUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(vendorEventsTable.occurredAt))
    .limit(options.limit ?? 200);

  return rows.map((r) => ({
    ...r.event,
    actorName: r.actorName,
    actorEmail: r.actorEmail,
  }));
}

export async function getVendor(
  accountId: string,
  vendorId: string
): Promise<Vendor | null> {
  const rows = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.accountId, accountId)))
    .limit(1);
  return rows[0] ?? null;
}

export type VendorIntelligence = {
  totalSpendLifetimeCents: number;
  totalSavingsLifetimeCents: number;
  subscriptionCount: number;
  decisionCount: number;
  /** Average annualized cost change per renewal cycle (positive = increase). */
  averagePriceChangePct: number | null;
  /** Most recent decision per subscription, for the "what did we do last time" surface. */
  lastDecisions: Array<{
    subscriptionId: string;
    productName: string;
    decision: string;
    decisionAt: Date | null;
    rationaleCodes: string[];
    negotiationLever: string;
  }>;
  /** Multi-select histogram of rationale codes the team has used with this vendor. */
  rationaleHistogram: Record<string, number>;
};

/**
 * Derived analytics for the vendor intelligence card. All queries scoped to
 * accountId; no cross-account read possible.
 */
export async function getVendorIntelligence(
  accountId: string,
  vendorId: string
): Promise<VendorIntelligence> {
  // Total spend lifetime = sum of every subscription's totalCostPerPeriodCents
  // annualized. Cheap aggregate.
  const totalSpend = await db
    .select({
      cents: sql<number>`coalesce(
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
      )::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.accountId, accountId),
        eq(subscriptionsTable.vendorId, vendorId)
      )
    );

  const savingsRow = await db
    .select({
      cents: sql<number>`coalesce(sum(${savingsRecordsTable.savedAnnualUsdCents}), 0)::int`,
    })
    .from(savingsRecordsTable)
    .innerJoin(
      subscriptionsTable,
      eq(savingsRecordsTable.subscriptionId, subscriptionsTable.id)
    )
    .where(
      and(
        eq(savingsRecordsTable.accountId, accountId),
        eq(subscriptionsTable.vendorId, vendorId)
      )
    );

  const decisionRows = await db
    .select({
      subscriptionId: renewalEventsTable.subscriptionId,
      decision: renewalEventsTable.decision,
      decisionAt: renewalEventsTable.decisionAt,
      productName: subscriptionsTable.productName,
      rationaleCodesJson: decisionContextsTable.rationaleCodesJson,
      negotiationLever: decisionContextsTable.negotiationLever,
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .leftJoin(
      decisionContextsTable,
      eq(decisionContextsTable.renewalEventId, renewalEventsTable.id)
    )
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.vendorId, vendorId),
        sql`${renewalEventsTable.decision} IS NOT NULL`
      )
    )
    .orderBy(desc(renewalEventsTable.decisionAt));

  // Walk price_changed events to compute average delta.
  const priceEvents = await db
    .select({
      payload: vendorEventsTable.payload,
    })
    .from(vendorEventsTable)
    .where(
      and(
        eq(vendorEventsTable.accountId, accountId),
        eq(vendorEventsTable.vendorId, vendorId),
        eq(vendorEventsTable.kind, "price_changed")
      )
    );
  let totalPct = 0;
  let priceChangeCount = 0;
  for (const ev of priceEvents) {
    const p = ev.payload as { deltaPct?: number } | null;
    if (p && typeof p.deltaPct === "number") {
      totalPct += p.deltaPct;
      priceChangeCount++;
    }
  }
  const averagePriceChangePct =
    priceChangeCount > 0 ? Number((totalPct / priceChangeCount).toFixed(2)) : null;

  // Build the per-subscription "last decision" list (one row per subscription).
  const seen = new Set<string>();
  const lastDecisions: VendorIntelligence["lastDecisions"] = [];
  for (const row of decisionRows) {
    if (seen.has(row.subscriptionId)) continue;
    seen.add(row.subscriptionId);
    const rationale = Array.isArray(row.rationaleCodesJson)
      ? (row.rationaleCodesJson as string[])
      : [];
    lastDecisions.push({
      subscriptionId: row.subscriptionId,
      productName: row.productName,
      decision: row.decision ?? "",
      decisionAt: row.decisionAt,
      rationaleCodes: rationale,
      negotiationLever: row.negotiationLever ?? "none",
    });
  }

  // Histogram of rationale codes across all decisions for this vendor.
  const histogram: Record<string, number> = {};
  for (const row of decisionRows) {
    if (Array.isArray(row.rationaleCodesJson)) {
      for (const code of row.rationaleCodesJson as string[]) {
        histogram[code] = (histogram[code] ?? 0) + 1;
      }
    }
  }

  return {
    totalSpendLifetimeCents: totalSpend[0]?.cents ?? 0,
    totalSavingsLifetimeCents: savingsRow[0]?.cents ?? 0,
    subscriptionCount: totalSpend[0]?.count ?? 0,
    decisionCount: decisionRows.length,
    averagePriceChangePct,
    lastDecisions,
    rationaleHistogram: histogram,
  };
}

export async function getDecisionContext(
  accountId: string,
  renewalEventId: string
): Promise<DecisionContext | null> {
  const rows = await db
    .select()
    .from(decisionContextsTable)
    .where(
      and(
        eq(decisionContextsTable.accountId, accountId),
        eq(decisionContextsTable.renewalEventId, renewalEventId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export type VendorListRow = Vendor & {
  subscriptionCount: number;
  annualizedSpendCents: number;
  lastEventAt: Date | null;
};

/**
 * Vendors index — one row per vendor with derived counts. Powers the
 * `/vendors` list page.
 */
export async function listVendorsWithIntelligence(
  accountId: string
): Promise<VendorListRow[]> {
  const rows = await db
    .select({
      vendor: vendorsTable,
      subscriptionCount: sql<number>`count(distinct ${subscriptionsTable.id})::int`,
      annualizedSpendCents: sql<number>`coalesce(
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
      )::int`,
    })
    .from(vendorsTable)
    .leftJoin(
      subscriptionsTable,
      and(
        eq(vendorsTable.id, subscriptionsTable.vendorId),
        eq(subscriptionsTable.status, "active")
      )
    )
    .where(eq(vendorsTable.accountId, accountId))
    .groupBy(vendorsTable.id)
    .orderBy(asc(vendorsTable.name));

  // Most-recent event per vendor — single query.
  const lastEvents = await db
    .select({
      vendorId: vendorEventsTable.vendorId,
      occurredAt: sql<Date>`max(${vendorEventsTable.occurredAt})`,
    })
    .from(vendorEventsTable)
    .where(eq(vendorEventsTable.accountId, accountId))
    .groupBy(vendorEventsTable.vendorId);
  const lastEventByVendor = new Map(lastEvents.map((e) => [e.vendorId, e.occurredAt]));

  return rows.map((r) => ({
    ...r.vendor,
    subscriptionCount: r.subscriptionCount,
    annualizedSpendCents: r.annualizedSpendCents,
    lastEventAt: lastEventByVendor.get(r.vendor.id) ?? null,
  }));
}

// Reference sql to satisfy unused warning checks in environments where the
// import survives tree-shaking validations.
void gte;
