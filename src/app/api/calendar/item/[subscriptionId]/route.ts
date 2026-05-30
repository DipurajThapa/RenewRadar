import { NextResponse } from "next/server";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { getSubscriptionDetail } from "@server/infrastructure/db/repositories/subscriptions";
import { buildVCalendar, type IcsEventInput } from "@server/domain/ics/builder";

export const dynamic = "force-dynamic";

/**
 * Single-item calendar download for one renewal item's notice deadline (and the
 * renewal/expiry date itself). Tenant-scoped via the same resolver the rest of
 * the app uses — returns 404 if the subscription isn't in the caller's account.
 * Reuses the shared ICS builder (no second calendar implementation).
 */
export async function GET(
  _req: Request,
  { params }: { params: { subscriptionId: string } }
): Promise<NextResponse> {
  const { account } = await getCurrentAccountAndUser();
  const detail = await getSubscriptionDetail(account.id, params.subscriptionId);
  if (!detail) {
    return new NextResponse("Not found", { status: 404 });
  }

  const today = new Date().toISOString().split("T")[0]!;
  const { subscription, vendor, renewalEvent } = detail;
  const isSaas = subscription.category === "saas_subscription";
  const events: IcsEventInput[] = [];

  if (renewalEvent) {
    events.push({
      uid: `notice-${renewalEvent.id}@renewalradar`,
      dtstamp: today,
      dtstart: renewalEvent.noticeDeadline,
      summary: `Notice deadline: ${vendor.name} — ${subscription.productName}`,
      description: `Last day to give notice before ${vendor.name} ${
        isSaas ? "auto-renews" : "lapses"
      } on ${renewalEvent.renewalDate}. Decide in Renewal Radar.`,
      alarms: [
        { hoursBefore: 24 * 7, description: "Notice deadline in 1 week" },
      ],
    });
    events.push({
      uid: `renewal-${renewalEvent.id}@renewalradar`,
      dtstamp: today,
      dtstart: renewalEvent.renewalDate,
      summary: `${isSaas ? "Renewal" : "Expiry"}: ${vendor.name} — ${subscription.productName}`,
      description: `${vendor.name} ${subscription.productName} ${
        isSaas ? "renews" : "expires"
      } today.`,
      alarms: [],
    });
  } else {
    // Draft / no scheduled event — anchor on the term end date if we have one.
    events.push({
      uid: `term-${subscription.id}@renewalradar`,
      dtstamp: today,
      dtstart: subscription.termEndDate,
      summary: `${isSaas ? "Renewal" : "Expiry"}: ${vendor.name} — ${subscription.productName}`,
      description: `${vendor.name} ${subscription.productName} ${
        isSaas ? "renews" : "expires"
      } on ${subscription.termEndDate}.`,
      alarms: [
        { hoursBefore: 24 * 7, description: "Renewal item due in 1 week" },
      ],
    });
  }

  const body = buildVCalendar(
    `${vendor.name} — ${subscription.productName}`,
    events
  );
  const filename = `${vendor.name.toLowerCase().replace(/\s+/g, "-")}-${subscription.termEndDate}.ics`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
