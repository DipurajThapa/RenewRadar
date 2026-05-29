/**
 * A3 — composeInternalNotice is pure, deterministic, and INTERNAL-only.
 */
import { describe, expect, it } from "vitest";
import { composeInternalNotice } from "@server/domain/renewal-notice/compose";

const INPUT = {
  vendorName: "Datadog",
  productName: "Pro",
  termEndDate: "2026-12-31",
  noticePeriodDays: 30,
  annualValueCents: 600_000,
  autoRenew: true,
  recommendedAction: "renewed_with_adjustments",
  headline: "Renew — but renegotiate first.",
  confidencePct: 72,
  points: ["Price rose 12% YoY", "Benchmark says you're in the top quartile"],
};

describe("composeInternalNotice", () => {
  it("is deterministic", () => {
    expect(composeInternalNotice(INPUT)).toEqual(composeInternalNotice(INPUT));
  });

  it("is INTERNAL-addressed and never addressed to the vendor", () => {
    const { subject, bodyText } = composeInternalNotice(INPUT);
    expect(subject).toContain("Internal renewal notice");
    expect(bodyText).toContain("INTERNAL MEMO");
    expect(bodyText).toContain("does not contact vendors on your behalf");
    // No vendor-letter salutation.
    expect(bodyText).not.toMatch(/To Whom It May Concern/i);
    expect(bodyText).not.toMatch(/Dear (Datadog|vendor)/i);
  });

  it("includes the notice deadline, recommendation, and supporting points", () => {
    const { bodyText } = composeInternalNotice(INPUT);
    expect(bodyText).toContain("renew, but renegotiate first");
    expect(bodyText).toContain("$6,000"); // annualized value
    expect(bodyText).toContain("Price rose 12% YoY");
    // notice deadline = termEnd − 30 days = 2026-12-01
    expect(bodyText).toContain("2026-12-01");
  });

  it("carries the not-legal-advice disclaimer", () => {
    expect(composeInternalNotice(INPUT).bodyText).toMatch(/not legal advice/i);
  });
});
