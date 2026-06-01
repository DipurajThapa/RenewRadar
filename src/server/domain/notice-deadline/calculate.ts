export const NOTICE_THRESHOLDS = [30, 14, 7, 3, 1] as const;
export type NoticeThreshold = (typeof NOTICE_THRESHOLDS)[number];

/**
 * Pure function: given a subscription's term end and notice period,
 * returns the date by which the customer must give notice to cancel.
 *
 * Date math in UTC at midnight to avoid TZ drift across the cron, the user's
 * view, and the database (which stores the field as DATE, not TIMESTAMPTZ).
 */
export function calculateNoticeDeadline(
  termEndDate: string | Date,
  noticePeriodDays: number
): Date {
  const termEnd =
    typeof termEndDate === "string"
      ? new Date(`${termEndDate}T00:00:00Z`)
      : new Date(
          Date.UTC(
            termEndDate.getUTCFullYear(),
            termEndDate.getUTCMonth(),
            termEndDate.getUTCDate()
          )
        );

  const deadline = new Date(termEnd);
  deadline.setUTCDate(deadline.getUTCDate() - noticePeriodDays);
  return deadline;
}

/**
 * Calendar days until the notice deadline. Negative if past.
 */
export function daysUntilNoticeDeadline(
  termEndDate: string | Date,
  noticePeriodDays: number,
  today: Date = new Date()
): number {
  return daysUntilDate(
    calculateNoticeDeadline(termEndDate, noticePeriodDays),
    today
  );
}

/**
 * Calendar days from today until an already-resolved date (e.g. a renewal
 * event's stored `noticeDeadline`). Negative if the date is in the past. UTC
 * midnight on both sides to match the DATE columns and avoid TZ drift.
 *
 * Prefer this over recomputing from a subscription's termEndDate when an
 * authoritative event deadline already exists — the subscription's term may
 * still point at a prior cycle while the event tracks the upcoming one.
 */
export function daysUntilDate(
  target: string | Date,
  today: Date = new Date()
): number {
  const targetUtc =
    typeof target === "string"
      ? new Date(`${target}T00:00:00Z`)
      : new Date(
          Date.UTC(
            target.getUTCFullYear(),
            target.getUTCMonth(),
            target.getUTCDate()
          )
        );
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const diffMs = targetUtc.getTime() - todayUtc.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Maps a threshold day count to its notification trigger enum value.
 */
export function triggerForThreshold(threshold: NoticeThreshold): string {
  return `notice_window_${threshold}`;
}
