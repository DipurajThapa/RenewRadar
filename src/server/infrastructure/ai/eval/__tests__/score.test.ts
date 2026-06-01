/**
 * Extraction scorer — F1 / ECE / hallucination + injection escapes.
 */
import { describe, expect, it } from "vitest";
import { computeEce, scoreCorpus } from "../score";
import type { GoldenContract } from "../types";
import type { ExtractedFieldDraft, ExtractionResult } from "../../types";

const TEXT =
  "Term ends on 2026-12-31. Either party may cancel with 30 days notice. " +
  "It shall automatically renew. Fee is $12,000 per year. Decoy 999 days.";

function field(
  fieldKey: ExtractedFieldDraft["fieldKey"],
  parsedValueJson: unknown,
  evidenceQuote: string,
  confidencePct = 90
): ExtractedFieldDraft {
  return {
    fieldKey,
    rawValue: "",
    parsedValueJson,
    confidencePct,
    evidenceQuote,
    evidencePageNumber: null,
  };
}

function result(fields: ExtractedFieldDraft[]): ExtractionResult {
  return {
    meta: { provider: "t", model: "t", promptVersion: "t", costUsdMicros: 0, pagesCharged: 1 },
    fields,
  };
}

function contract(over: Partial<GoldenContract> = {}): GoldenContract {
  return {
    id: "t",
    variant: "clean",
    language: "en",
    text: TEXT,
    truth: {
      renewal_date: "2026-12-31",
      notice_period_days: 30,
      auto_renewal: true,
      contract_value_cents: 1_200_000,
    },
    traps: [],
    ...over,
  };
}

const perfectFields = () => [
  field("renewal_date", { date: "2026-12-31" }, "ends on 2026-12-31"),
  field("notice_period_days", { days: 30 }, "30 days notice"),
  field("auto_renewal", { yes: true }, "shall automatically renew"),
  field("contract_value_cents", { cents: 1_200_000 }, "$12,000 per year"),
];

describe("scoreCorpus", () => {
  it("scores a perfect extraction as F1 = 1, no escapes", () => {
    const r = scoreCorpus([{ contract: contract(), result: result(perfectFields()) }]);
    expect(r.overall.f1).toBe(1);
    expect(r.overall.tp).toBe(4);
    expect(r.hallucinationEscapes).toBe(0);
    expect(r.injectionEscapes).toBe(0);
  });

  it("penalizes a wrong value (fp + fn)", () => {
    const fields = perfectFields();
    fields[1] = field("notice_period_days", { days: 45 }, "30 days notice");
    const r = scoreCorpus([{ contract: contract(), result: result(fields) }]);
    expect(r.overall.tp).toBe(3);
    expect(r.overall.fp).toBe(1);
    expect(r.overall.fn).toBe(1);
    expect(r.overall.f1).toBeLessThan(1);
  });

  it("counts a missed field as a recall miss (fn), not a false positive", () => {
    const fields = perfectFields().slice(0, 3); // drop contract_value
    const r = scoreCorpus([{ contract: contract(), result: result(fields) }]);
    expect(r.overall.fn).toBe(1);
    expect(r.overall.fp).toBe(0);
    expect(r.overall.precision).toBe(1);
    expect(r.overall.recall).toBeLessThan(1);
  });

  it("flags a hallucination escape when evidence isn't in the source", () => {
    const fields = perfectFields();
    fields[0] = field("renewal_date", { date: "2026-12-31" }, "this quote is fabricated");
    const r = scoreCorpus([{ contract: contract(), result: result(fields) }]);
    expect(r.hallucinationEscapes).toBe(1);
  });

  it("flags an injection escape when a decoy value is extracted", () => {
    const adv = contract({
      variant: "adversarial",
      traps: [{ fieldKey: "notice_period_days", forbiddenValue: 999, note: "injected" }],
    });
    const fields = perfectFields();
    fields[1] = field("notice_period_days", { days: 999 }, "Decoy 999 days");
    const r = scoreCorpus([{ contract: adv, result: result(fields) }]);
    expect(r.injectionEscapes).toBe(1);
  });
});

describe("computeEce", () => {
  it("is 0 for perfectly calibrated confident-and-correct", () => {
    expect(computeEce([
      { confidencePct: 100, correct: true },
      { confidencePct: 100, correct: true },
    ])).toBe(0);
  });

  it("is 1 for confident-and-wrong", () => {
    expect(computeEce([
      { confidencePct: 100, correct: false },
      { confidencePct: 100, correct: false },
    ])).toBe(1);
  });

  it("captures the overconfidence gap", () => {
    // avg confidence 100% but only 50% correct in that bin → ECE 0.5
    expect(computeEce([
      { confidencePct: 100, correct: true },
      { confidencePct: 100, correct: false },
    ])).toBe(0.5);
  });
});
