/**
 * Pure-function tests for the notice-deadline math.
 *
 * This is the load-bearing arithmetic of the entire product — if it drifts,
 * every downstream alert, calendar, and state transition drifts with it. The
 * tests pin the contract.
 */
import { describe, expect, it } from "vitest";
import {
  NOTICE_THRESHOLDS,
  calculateNoticeDeadline,
  daysUntilNoticeDeadline,
  triggerForThreshold,
} from "@server/domain/notice-deadline/calculate";

describe("calculateNoticeDeadline", () => {
  it("subtracts the notice period from the term end date", () => {
    const deadline = calculateNoticeDeadline("2026-12-31", 30);
    expect(deadline.toISOString().split("T")[0]).toBe("2026-12-01");
  });

  it("handles a zero-day notice period (deadline === term end)", () => {
    const deadline = calculateNoticeDeadline("2026-12-31", 0);
    expect(deadline.toISOString().split("T")[0]).toBe("2026-12-31");
  });

  it("handles a long notice period that crosses a year boundary", () => {
    const deadline = calculateNoticeDeadline("2026-02-01", 60);
    expect(deadline.toISOString().split("T")[0]).toBe("2025-12-03");
  });

  it("accepts a Date input as well as a string", () => {
    const termEnd = new Date(Date.UTC(2026, 11, 31)); // Dec 31 2026
    const deadline = calculateNoticeDeadline(termEnd, 30);
    expect(deadline.toISOString().split("T")[0]).toBe("2026-12-01");
  });

  it("does not mutate the input Date", () => {
    const termEnd = new Date(Date.UTC(2026, 11, 31));
    const before = termEnd.toISOString();
    calculateNoticeDeadline(termEnd, 30);
    expect(termEnd.toISOString()).toBe(before);
  });

  it("is timezone-safe (DST boundary near term end)", () => {
    // 2026-03-08 → DST starts in the US that day. The function works in UTC,
    // so the result is the same regardless of the host's TZ offset.
    const deadline = calculateNoticeDeadline("2026-04-08", 30);
    expect(deadline.toISOString().split("T")[0]).toBe("2026-03-09");
  });
});

describe("daysUntilNoticeDeadline", () => {
  it("returns 0 when today === the deadline", () => {
    const today = new Date(Date.UTC(2026, 5, 1));
    // term end 30 days later, notice period 30 → deadline = today
    const days = daysUntilNoticeDeadline("2026-07-01", 30, today);
    expect(days).toBe(0);
  });

  it("returns positive when the deadline is in the future", () => {
    const today = new Date(Date.UTC(2026, 5, 1));
    const days = daysUntilNoticeDeadline("2026-08-01", 30, today);
    expect(days).toBe(31); // Jul 1 - Jun 1 = 30 days; but Jul has 31, so Aug 1 - 30 = Jul 2
    // explicit: term end 2026-08-01, notice 30 → deadline 2026-07-02
    // Jul 2 - Jun 1 = 31 days. ✓
  });

  it("returns negative when the deadline has passed", () => {
    const today = new Date(Date.UTC(2026, 5, 1)); // Jun 1
    const days = daysUntilNoticeDeadline("2026-05-15", 30, today);
    // deadline = Apr 15. Apr 15 - Jun 1 = -47
    expect(days).toBe(-47);
  });

  it("rounds (does not floor) cross-DST boundaries", () => {
    // If the function returned floor() of a non-integer-day diff, this would
    // be off by one on DST days. Using Math.round() in UTC keeps it stable.
    const today = new Date(Date.UTC(2026, 2, 8, 12, 0, 0)); // mid-day, DST day
    const days = daysUntilNoticeDeadline("2026-04-08", 30, today);
    expect(days).toBe(1); // Mar 9 - Mar 8 = 1
  });
});

describe("triggerForThreshold", () => {
  it("produces the expected enum value for every canonical threshold", () => {
    const expected: Record<number, string> = {
      30: "notice_window_30",
      14: "notice_window_14",
      7: "notice_window_7",
      3: "notice_window_3",
      1: "notice_window_1",
    };
    for (const t of NOTICE_THRESHOLDS) {
      expect(triggerForThreshold(t)).toBe(expected[t]);
    }
  });
});
