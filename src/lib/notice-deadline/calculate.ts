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
  const deadline = calculateNoticeDeadline(termEndDate, noticePeriodDays);
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const diffMs = deadline.getTime() - todayUtc.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Maps a threshold day count to its notification trigger enum value.
 */
export function triggerForThreshold(threshold: NoticeThreshold): string {
  return `notice_window_${threshold}`;
}
