import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { tierFeatureDeniedResponse } from "@server/middleware/tier-feature-response";
import {
  requireTierFeature,
  TierFeatureDeniedError,
} from "@server/domain/billing/tier-features";
import { rowsToCsv, type ExportRow } from "@server/infrastructure/csv/subscriptions-format";

export const dynamic = "force-dynamic";

/**
 * Streams all subscriptions for the current account as a CSV download.
 *
 * Route handler instead of a Server Action because we need to return a body
 * with Content-Type=text/csv and Content-Disposition=attachment to trigger
 * the browser download. Server actions can't set arbitrary response headers.
 *
 * Tenant scoped via `accountId` on every query, and gated by tier feature
 * flag — CSV export is Starter+.
 */
export async function GET() {
  const { account } = await getCurrentAccountAndUser();

  try {
    requireTierFeature(account.planTier, "csvImportExport");
  } catch (err) {
    if (err instanceof TierFeatureDeniedError) {
      return tierFeatureDeniedResponse(err);
    }
    throw err;
  }

  const rows = await db
    .select({
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      planName: subscriptionsTable.planName,
      billingCycle: subscriptionsTable.billingCycle,
      termStartDate: subscriptionsTable.termStartDate,
      termEndDate: subscriptionsTable.termEndDate,
      noticePeriodDays: subscriptionsTable.noticePeriodDays,
      totalSeats: subscriptionsTable.totalSeats,
      unitPriceCents: subscriptionsTable.unitPriceCents,
      totalCostPerPeriodCents: subscriptionsTable.totalCostPerPeriodCents,
      autoRenew: subscriptionsTable.autoRenew,
      status: subscriptionsTable.status,
      ownerEmail: usersTable.workEmail,
      notes: subscriptionsTable.notes,
    })
    .from(subscriptionsTable)
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(subscriptionsTable.ownerUserId, usersTable.id))
    .where(eq(subscriptionsTable.accountId, account.id))
    .orderBy(asc(vendorsTable.name), asc(subscriptionsTable.productName));

  const csv = rowsToCsv(rows as ExportRow[]);
  const filename = `renewal-radar-subscriptions-${new Date()
    .toISOString()
    .split("T")[0]}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Subscriptions data is account-private; never cache.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
