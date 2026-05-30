/**
 * Cross-type urgency ranking for the unified "Needs you" queue. One pure
 * function so a renewal due tomorrow, a 3-week-old review, and a high-confidence
 * spend match all land on the SAME 0-100 scale and interleave correctly.
 *
 * Deadline proximity dominates when a hard deadline exists; otherwise age (for
 * the review/request inboxes that have no deadline) or an intrinsic signal
 * (spend match confidence) drives it.
 */

export type NeedsYouType =
  | "renewal"
  | "review"
  | "approval"
  | "request"
  | "spend";

export type RankSignals = {
  /** Days until a hard deadline; negative = overdue. Null when none. */
  daysUntilDeadline?: number | null;
  /** Intrinsic 0-100 signal (renewal risk score, spend confidence, …). */
  intrinsic?: number;
  /** Age in days since created — for deadline-less items (reviews/requests). */
  ageDays?: number | null;
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function urgencyScore(s: RankSignals): number {
  // A hard deadline dominates: overdue → max, otherwise closer → higher, but
  // never below the item's intrinsic signal (a high-risk renewal 40 days out
  // still outranks a benign one).
  if (s.daysUntilDeadline != null) {
    if (s.daysUntilDeadline < 0) return 100;
    const proximity = Math.max(0, 100 - s.daysUntilDeadline * 2); // 0d→100, 50d→0
    return clamp(Math.max(proximity, s.intrinsic ?? 0));
  }
  // No deadline: age-driven, capped below deadline-bearing items so a stale
  // review can't permanently outrank a renewal that's actually due.
  if (s.ageDays != null) {
    return clamp(Math.min(75, Math.max(s.intrinsic ?? 0, s.ageDays * 5)));
  }
  return clamp(s.intrinsic ?? 10);
}
