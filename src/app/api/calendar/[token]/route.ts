import { NextResponse } from "next/server";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@/lib/db/schema";
import { findAccountByIcsToken } from "@/lib/db/queries/integrations";
import { calculateNoticeDeadline } from "@/lib/notice-deadline/calculate";

export const dynamic = "force-dynamic";

/**
 * iCal feed.
 *
 * Public-by-token: anyone who knows the URL can read it. We rely on the
 * unguessability of the token (32 random bytes hex-encoded) — there is no
 * Clerk auth on this route by design, because Google Calendar / Outlook
 * subscription endpoints don't carry user credentials.
 *
 * The token is rotatable from `/settings/integrations` — rotation invalidates
 * the prior subscription URL.
 */
export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  const token = (params.token ?? "").replace(/\.ics$/, "");
  if (!token || token.length < 16) {
    return new NextResponse("Not found", { status: 404 });
  }

  const found = await findAccountByIcsToken(token);
  if (!found) {
    return new NextResponse("Not found", { status: 404 });
  }

  const today = new Date().toISOString().split("T")[0]!;

  const rows = await db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      renewalDate: renewalEventsTable.renewalDate,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      termEndDate: subscriptionsTable.termEndDate,
      noticePeriodDays: subscriptionsTable.noticePeriodDays,
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      // Tenant scope + drop past renewals — they clutter the calendar.
      and(
        eq(subscriptionsTable.accountId, found.accountId),
        gte(renewalEventsTable.renewalDate, today)
      )
    )
    .orderBy(asc(renewalEventsTable.renewalDate));

  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Renewal Radar//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push("X-WR-CALNAME:Renewal Radar — deadlines");

  for (const row of rows) {
    // Two events per renewal: the notice deadline and the renewal date itself.
    // Both are all-day events.
    const noticeDeadline = row.noticeDeadline;
    const renewalDate = row.renewalDate;

    lines.push(...icsEvent({
      uid: `notice-${row.renewalEventId}@renewalradar`,
      dtstamp: today,
      dtstart: noticeDeadline,
      summary: `Notice deadline: ${row.vendorName} — ${row.productName}`,
      description: `Last day to give notice before ${row.vendorName} auto-renews on ${renewalDate}. Decide in Renewal Radar.`,
      // 9am UTC alarm one week out
      alarms: [{ hoursBefore: 24 * 7, description: "Notice deadline in 1 week" }],
    }));

    lines.push(...icsEvent({
      uid: `renewal-${row.renewalEventId}@renewalradar`,
      dtstamp: today,
      dtstart: renewalDate,
      summary: `Renewal: ${row.vendorName} — ${row.productName}`,
      description: `${row.vendorName} ${row.productName} renews today. Notice deadline was ${noticeDeadline}.`,
      alarms: [],
    }));
  }

  lines.push("END:VCALENDAR");

  void calculateNoticeDeadline; // kept for future per-event alarm anchoring

  return new NextResponse(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function icsEvent(input: {
  uid: string;
  dtstamp: string;
  dtstart: string; // YYYY-MM-DD
  summary: string;
  description: string;
  alarms: { hoursBefore: number; description: string }[];
}): string[] {
  const out: string[] = [];
  out.push("BEGIN:VEVENT");
  out.push(`UID:${input.uid}`);
  out.push(`DTSTAMP:${input.dtstamp.replace(/-/g, "")}T000000Z`);
  out.push(`DTSTART;VALUE=DATE:${input.dtstart.replace(/-/g, "")}`);
  out.push(`SUMMARY:${escapeIcsText(input.summary)}`);
  out.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  for (const alarm of input.alarms) {
    out.push("BEGIN:VALARM");
    out.push("ACTION:DISPLAY");
    out.push(`DESCRIPTION:${escapeIcsText(alarm.description)}`);
    out.push(`TRIGGER:-PT${alarm.hoursBefore}H`);
    out.push("END:VALARM");
  }
  out.push("END:VEVENT");
  return out;
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
