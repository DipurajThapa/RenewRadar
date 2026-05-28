import { NOTICE_THRESHOLDS, type NoticeThreshold } from "./calculate";

export { NOTICE_THRESHOLDS };
export type { NoticeThreshold };

/**
 * Map an exact day count to its matching threshold, or null.
 * Only exact matches qualify — we want to fire one alert per threshold,
 * not "any deadline within the next N days."
 */
export function matchingThreshold(daysUntil: number): NoticeThreshold | null {
  return NOTICE_THRESHOLDS.find((t) => t === daysUntil) ?? null;
}

/**
 * Email subject for a given threshold. Escalates in tone as the deadline nears.
 */
export function emailSubjectForThreshold(
  threshold: NoticeThreshold,
  vendorName: string
): string {
  if (threshold >= 30) return `Notice window opens for ${vendorName}`;
  if (threshold === 14) return `${vendorName} notice deadline in 14 days — log a decision`;
  if (threshold === 7 || threshold === 3)
    return `ACTION NEEDED: ${vendorName} notice deadline in ${threshold} days`;
  if (threshold === 1) return `FINAL DAY: ${vendorName} notice deadline tomorrow`;
  return `Renewal Radar: ${vendorName} notice approaching`;
}

/**
 * Notification trigger enum value for a threshold.
 */
export function triggerForThreshold(
  threshold: NoticeThreshold
):
  | "notice_window_30"
  | "notice_window_14"
  | "notice_window_7"
  | "notice_window_3"
  | "notice_window_1" {
  return `notice_window_${threshold}` as
    | "notice_window_30"
    | "notice_window_14"
    | "notice_window_7"
    | "notice_window_3"
    | "notice_window_1";
}
