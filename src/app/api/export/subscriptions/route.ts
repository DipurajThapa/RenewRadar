import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@/lib/db/schema";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { rowsToCsv, type ExportRow } from "@/lib/csv/subscriptions-format";

export const dynamic = "force-dynamic";

/**
 * Streams all subscriptions for the current account as a CSV download.
 *
 * Route handler instead of a Server Action because we need to return a body
 * with Content-Type=text/csv and Content-Disposition=attachment to trigger
 * the browser download. Server actions can't set arbitrary response headers.
 *
 * Tenant scoped via `accountId` on every query, like the rest of the app.
 */
export async function GET() {
  const { account } = await getCurrentAccountAndUser();

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
