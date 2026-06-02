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
  // RFC 5545 §3.1: content lines longer than 75 OCTETS must be folded (CRLF
  // + leading whitespace). Tolerated by Apple/Google/Outlook calendars, but
  // strict parsers and `icalendar`-style validators warn about it. Fold each
  // line as the final step so authors don't have to think about it.
  return lines.map(foldIcsLine).join("\r\n");
}

/**
 * Fold a single content line per RFC 5545 §3.1. Splits at a 75-octet
 * boundary (measured in UTF-8 bytes) and inserts CRLF + a single space to
 * mark the continuation. Returns the original line unchanged if it already
 * fits.
 */
export function foldIcsLine(line: string): string {
  const MAX = 75;
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= MAX) return line;
  const decoder = new TextDecoder("utf-8");
  const parts: string[] = [];
  let cursor = 0;
  let first = true;
  while (cursor < bytes.length) {
    const limit = first ? MAX : MAX - 1; // continuation prefix steals 1 octet
    let end = Math.min(cursor + limit, bytes.length);
    // Don't slice inside a UTF-8 codepoint: walk back to a leading byte.
    while (end < bytes.length && (bytes[end]! & 0b1100_0000) === 0b1000_0000) {
      end--;
    }
    const chunk = decoder.decode(bytes.slice(cursor, end));
    parts.push(first ? chunk : " " + chunk);
    cursor = end;
    first = false;
  }
  return parts.join("\r\n");
}

export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
