/**
 * Calendar edge cases — production realities the cron and the cancellation
 * letter both depend on.
 *
 * domain/__tests__/edge-cases.test.ts already covers Feb 29 of a leap
 * year, year boundary in one direction, and DST spring-forward. The cases
 * below close the remaining calendar holes:
 *
 *   - Feb 29 of a NON-leap year (the deadline math must NEVER produce
 *     "Feb 29 2027" from "Feb 28 2027 minus 0 days")
 *   - US DST fall-back (Nov, opposite direction from spring forward)
 *   - 365-day notice that crosses a leap year exactly
 *   - daysUntilNoticeDeadline when both anchor and "today" straddle a
 *     month boundary at midnight
 *   - Negative notice period (degenerate input)
 */
import { describe, expect, it } from "vitest";
import {
  calculateNoticeDeadline,
  daysUntilNoticeDeadline,
} from "@server/domain/notice-deadline/calculate";

// ─────────────────────────────────────────────────────────────────────────
// Non-leap year February — the most common cron-misfire pattern
// ─────────────────────────────────────────────────────────────────────────

describe("notice deadline math on non-leap-year February", () => {
  it("Feb 28 2027 - 1 day = Feb 27 2027 (no phantom Feb 29)", () => {
    const d = calculateNoticeDeadline("2027-02-28", 1);
    // Format as YYYY-MM-DD in UTC for a deterministic assertion.
    expect(d.toISOString().split("T")[0]).toBe("2027-02-27");
  });

  it("Mar 1 2027 - 1 day = Feb 28 2027 (rolls back to last day of Feb)", () => {
    const d = calculateNoticeDeadline("2027-03-01", 1);
    expect(d.toISOString().split("T")[0]).toBe("2027-02-28");
  });

  it("Mar 30 2027 - 30 days = Feb 28 2027 (deadline lands on the 28th, not 29th)", () => {
    const d = calculateNoticeDeadline("2027-03-30", 30);
    expect(d.toISOString().split("T")[0]).toBe("2027-02-28");
  });

  it("Mar 31 2027 - 60 days = Jan 30 2027 (60 days back from Mar 31 in non-leap year)", () => {
    const d = calculateNoticeDeadline("2027-03-31", 60);
    // Counting back: Mar 31 - 31 days = Feb 28; - 28 more = Jan 31; - 1 more = Jan 30.
    expect(d.toISOString().split("T")[0]).toBe("2027-01-30");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// US DST fall-back — Nov 1 2026 is the Sunday of "fall back" in the US.
// We compute in UTC so the answer must NOT shift by an hour.
// ─────────────────────────────────────────────────────────────────────────

describe("notice deadline math across US DST fall-back (Nov 2026)", () => {
  it("Nov 30 2026 - 30 days = Oct 31 2026 across fall-back boundary", () => {
    const d = calculateNoticeDeadline("2026-11-30", 30);
    expect(d.toISOString().split("T")[0]).toBe("2026-10-31");
  });

  it("Nov 1 2026 - 1 day = Oct 31 2026 (DST shift doesn't affect UTC math)", () => {
    const d = calculateNoticeDeadline("2026-11-01", 1);
    expect(d.toISOString().split("T")[0]).toBe("2026-10-31");
  });

  it("daysUntilNoticeDeadline crossing fall-back returns exactly the day count", () => {
    // Today = Oct 31 (before fall-back). Term end = Nov 30. Notice = 30.
    // Deadline = Oct 31. Days = 0.
    const today = new Date("2026-10-31T12:00:00Z");
    expect(daysUntilNoticeDeadline("2026-11-30", 30, today)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 365-day notice that crosses a leap day
// ─────────────────────────────────────────────────────────────────────────

describe("notice deadline math across a leap day", () => {
  it("365-day notice from Mar 1 2029 lands on Mar 1 2028 (leap year present)", () => {
    // From Mar 1 2029 counting back 365 days hits Mar 1 2028 (since 2028
    // had an extra day in February, +365 from Mar 1 2028 = Feb 28 2029,
    // so -365 from Mar 1 2029 = Mar 1 2028). This pins UTC-day arithmetic
    // and protects against an off-by-one that would otherwise creep in
    // around leap days.
    const d = calculateNoticeDeadline("2029-03-01", 365);
    expect(d.toISOString().split("T")[0]).toBe("2028-03-01");
  });

  it("366-day notice from Mar 1 2029 lands on Feb 29 2028 (the leap day itself)", () => {
    const d = calculateNoticeDeadline("2029-03-01", 366);
    expect(d.toISOString().split("T")[0]).toBe("2028-02-29");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Year-boundary anchors (Dec 31 ↔ Jan 1)
// ─────────────────────────────────────────────────────────────────────────

describe("notice deadline math at year boundaries", () => {
  it("Jan 1 2027 - 1 day = Dec 31 2026 (rolls over to previous year)", () => {
    const d = calculateNoticeDeadline("2027-01-01", 1);
    expect(d.toISOString().split("T")[0]).toBe("2026-12-31");
  });

  it("Jan 1 2027 - 365 days = Jan 1 2026 (365 days back from a non-leap year)", () => {
    const d = calculateNoticeDeadline("2027-01-01", 365);
    expect(d.toISOString().split("T")[0]).toBe("2026-01-01");
  });

  it("Dec 31 2026 - 0 days = Dec 31 2026 (no-shift case)", () => {
    const d = calculateNoticeDeadline("2026-12-31", 0);
    expect(d.toISOString().split("T")[0]).toBe("2026-12-31");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Defensive: negative notice period (degenerate input we shouldn't accept
// in the UI but must not crash the cron)
// ─────────────────────────────────────────────────────────────────────────

describe("notice deadline math on degenerate inputs", () => {
  it("a negative notice period shifts the deadline AFTER the term end (documented behavior)", () => {
    // -5 day notice means the deadline is 5 days AFTER term end. That's
    // nonsense as a customer-facing concept but pinning the math means a
    // future bug producing this state at least produces a deterministic
    // result instead of throwing inside the cron.
    const d = calculateNoticeDeadline("2026-12-31", -5);
    expect(d.toISOString().split("T")[0]).toBe("2027-01-05");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// daysUntilNoticeDeadline boundary precision
// ─────────────────────────────────────────────────────────────────────────

describe("daysUntilNoticeDeadline boundary precision", () => {
  it("exactly 0 when 'today' falls on the deadline date itself", () => {
    // Term end Feb 28 2027, 30-day notice → deadline Jan 29 2027.
    // Today = Jan 29 2027 12:00 UTC → 0 days until.
    const today = new Date("2027-01-29T12:00:00Z");
    expect(daysUntilNoticeDeadline("2027-02-28", 30, today)).toBe(0);
  });

  it("exactly -1 when 'today' is the day AFTER the deadline", () => {
    const today = new Date("2027-01-30T00:00:00Z");
    expect(daysUntilNoticeDeadline("2027-02-28", 30, today)).toBe(-1);
  });

  it("works when 'today' is at 23:59 UTC (boundary attack)", () => {
    // Same calendar day on both sides — must still be 0, not -1.
    const today = new Date("2027-01-29T23:59:59Z");
    expect(daysUntilNoticeDeadline("2027-02-28", 30, today)).toBe(0);
  });
});
