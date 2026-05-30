/**
 * Pure iCalendar building blocks. Extracted from the token-feed route so both
 * the multi-event account feed and a single-item per-subscription download
 * emit byte-identical VEVENTs from ONE implementation (no second calendar).
 */

export type IcsEventInput = {
  uid: string;
  dtstamp: string; // YYYY-MM-DD
  dtstart: string; // YYYY-MM-DD (all-day)
  summary: string;
  description: string;
  alarms: { hoursBefore: number; description: string }[];
};

export function icsEvent(input: IcsEventInput): string[] {
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

/** Wrap events in a complete VCALENDAR document (CRLF-joined, per RFC 5545). */
export function buildVCalendar(calName: string, events: IcsEventInput[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Renewal Radar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
  ];
  for (const e of events) lines.push(...icsEvent(e));
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
