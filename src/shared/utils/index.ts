import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date-only value as "MMM d, yyyy" in UTC.
 *
 * Why UTC, not the browser's local time:
 *   Contract dates (termEndDate, noticeDeadline, renewalDate) are stored as
 *   DATE columns — date-only, no timezone. When date-fns's `format` gets a
 *   Date object, it formats in the *browser's* local timezone, so a value
 *   stored as "2026-05-28" (UTC midnight) rendered as "May 27" for any user
 *   west of UTC. That's a one-day drift in calendar headers, digest emails,
 *   and the cancellation letter.
 *
 *   Intl.DateTimeFormat with `timeZone: "UTC"` formats deterministically —
 *   the displayed date always matches the stored date, regardless of who's
 *   looking.
 */
const DATE_FORMATTER_UTC = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Sentinel returned by `formatDate` / `formatRelativeDate` when the input
 * cannot be coerced into a real Date. The em-dash matches the empty-state
 * convention used across the UI (vendor list, audit log, action queue) so
 * a bad row reads naturally instead of crashing the page.
 *
 * Why this matters: this formatter is called from 24+ files. A single
 * upstream row with a malformed timestamp used to throw
 * `RangeError: Invalid time value` and 500 the entire server-rendered page.
 * Formatting helpers should fail closed (sentinel), not fail open (crash).
 */
const INVALID_DATE_SENTINEL = "—";

export function formatDate(date: Date | string | null | undefined): string {
  if (date == null) return INVALID_DATE_SENTINEL;
  const d =
    typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    return INVALID_DATE_SENTINEL;
  }
  return DATE_FORMATTER_UTC.format(d);
}

export function formatRelativeDate(
  date: Date | string | null | undefined
): string {
  if (date == null) return INVALID_DATE_SENTINEL;
  const d = typeof date === "string" ? new Date(date) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    return INVALID_DATE_SENTINEL;
  }
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatCurrency(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Whole UTC calendar days from "today UTC midnight" to the given date.
 *
 *   - Returns 0 when the date IS today (UTC).
 *   - Negative when in the past, positive when in the future.
 *
 * Why round (not ceil): both sides of the subtraction are normalized to
 * UTC midnight, so `diffMs` is always an exact multiple of 86_400_000.
 * `Math.round` and `Math.ceil` produce identical answers for integer
 * multiples; using round keeps this helper in lockstep with the domain
 * layer's `daysUntilNoticeDeadline`, which also uses round. Lockstep is
 * what guarantees the calendar, the action queue, and the digest email
 * can never disagree by one day.
 */
const ONE_DAY_MS = 1000 * 60 * 60 * 24;

export function daysUntil(date: Date | string): number {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date;
  const today = new Date();
  const todayUtcMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const diffMs = d.getTime() - todayUtcMs;
  return Math.round(diffMs / ONE_DAY_MS);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `${count} ${singular}`;
  return `${count} ${plural ?? `${singular}s`}`;
}
