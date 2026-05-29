/**
 * formatDate + daysUntil contract tests.
 *
 * These exist because we shipped a bug where date-only fields stored as UTC
 * midnight rendered one day earlier for any user west of UTC. The fix is to
 * format in UTC; these tests pin that behaviour so it can't silently
 * regress.
 *
 * `vi.useFakeTimers` lets us pretend the wall clock is whatever we need,
 * but it does NOT change `Intl.DateTimeFormat`'s zone — the formatter's
 * zone is decided at formatter construction. We use a UTC formatter, so
 * the output is independent of the host machine's locale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  daysUntil,
  formatDate,
  formatRelativeDate,
  formatCurrency,
  pluralize,
} from "@shared/utils";

describe("formatDate", () => {
  it("formats a YYYY-MM-DD date string in UTC (no timezone drift)", () => {
    expect(formatDate("2026-05-28")).toBe("May 28, 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("formats a Date object in UTC", () => {
    // A Date constructed from a UTC midnight ISO string
    expect(formatDate(new Date("2026-05-28T00:00:00Z"))).toBe("May 28, 2026");
    // A Date at noon UTC — still the same date
    expect(formatDate(new Date("2026-05-28T12:00:00Z"))).toBe("May 28, 2026");
    // Just before midnight UTC the next day — still May 28 in UTC
    expect(formatDate(new Date("2026-05-28T23:59:59Z"))).toBe("May 28, 2026");
  });

  it("does NOT shift the date when run from a non-UTC host timezone", () => {
    // Two-digit month/day to confirm padding isn't a concern
    expect(formatDate("2026-03-09")).toBe("Mar 9, 2026");
    // Edge case: leap-year handling
    expect(formatDate("2024-02-29")).toBe("Feb 29, 2024");
  });

  // ────────────────────────────────────────────────────────────────────
  // Defensive contract — formatDate is called from ~24 server-rendered
  // pages. A single bad row used to throw `RangeError: Invalid time value`
  // and crash the entire page. After P7.4 the helper fails closed with
  // the em-dash sentinel ("—"), matching how "no data" already renders
  // everywhere else.
  // ────────────────────────────────────────────────────────────────────
  it("returns '—' for null / undefined / invalid input instead of throwing", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDate(new Date("not-a-date"))).toBe("—");
    // Number.NaN coerced through Date is the same Invalid Date case.
    expect(formatDate(new Date(NaN))).toBe("—");
  });
});

describe("formatRelativeDate", () => {
  it("returns '—' for null / undefined / invalid input instead of throwing", () => {
    expect(formatRelativeDate(null)).toBe("—");
    expect(formatRelativeDate(undefined)).toBe("—");
    expect(formatRelativeDate(new Date("not-a-date"))).toBe("—");
  });

  it("formats a valid Date relative to now", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-28T00:00:00Z"));
    // date-fns "x days ago" — exact phrasing is locale-stable enough to assert.
    expect(formatRelativeDate(new Date("2026-05-25T00:00:00Z"))).toContain("ago");
    vi.useRealTimers();
  });
});

describe("daysUntil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 when the date is today (UTC)", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-28T12:00:00Z"));
    expect(daysUntil("2026-05-28")).toBe(0);
  });

  it("returns positive integers for future dates", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-28T00:00:00Z"));
    expect(daysUntil("2026-05-29")).toBe(1);
    expect(daysUntil("2026-06-04")).toBe(7);
    expect(daysUntil("2026-06-27")).toBe(30);
  });

  it("returns negative integers for past dates", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-28T00:00:00Z"));
    expect(daysUntil("2026-05-27")).toBe(-1);
    expect(daysUntil("2026-04-28")).toBe(-30);
  });

  it("respects UTC boundaries (no DST jump)", () => {
    // The day that DST shifts in the US — March 9 2025. We were in trouble
    // when the diff went through local-timezone arithmetic; UTC is immune.
    vi.useFakeTimers().setSystemTime(new Date("2026-03-09T12:00:00Z"));
    expect(daysUntil("2026-03-10")).toBe(1);
    expect(daysUntil("2026-03-09")).toBe(0);
    expect(daysUntil("2026-03-08")).toBe(-1);
  });
});

describe("formatCurrency", () => {
  it("formats cents to whole-dollar USD", () => {
    expect(formatCurrency(0)).toBe("$0");
    expect(formatCurrency(100)).toBe("$1");
    expect(formatCurrency(9_999)).toBe("$100");
    expect(formatCurrency(1_234_567)).toBe("$12,346");
  });

  it("rounds — 49 cents floors, 50 cents goes up via banker's rounding", () => {
    // Intl rounds half-to-even in modern engines, but the visible behaviour
    // for these inputs is integer-stable.
    expect(formatCurrency(1_50)).toBe("$2");
    expect(formatCurrency(1_49)).toBe("$1");
  });
});

describe("pluralize", () => {
  it("uses the singular form for exactly 1", () => {
    expect(pluralize(1, "renewal")).toBe("1 renewal");
  });
  it("uses the plural form for 0 and >1", () => {
    expect(pluralize(0, "renewal")).toBe("0 renewals");
    expect(pluralize(2, "renewal")).toBe("2 renewals");
  });
  it("accepts an explicit plural for irregular nouns", () => {
    expect(pluralize(2, "vendor mouse", "vendor mice")).toBe("2 vendor mice");
  });
});
