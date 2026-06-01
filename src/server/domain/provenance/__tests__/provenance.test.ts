import { describe, expect, it } from "vitest";
import {
  fieldProvenance,
  claimProvenance,
  PROVENANCE_LABEL_TEXT,
} from "@server/domain/provenance/labels";
import {
  computeMissingInfo,
  extractableFieldsNotPresent,
  type RenewalItemFacts,
} from "@server/domain/provenance/missing-info";
import type { BriefClaim } from "@server/infrastructure/ai/reasoning/types";

describe("fieldProvenance", () => {
  it("treats human-confirmed review states as VERIFIED regardless of confidence", () => {
    for (const status of ["accepted", "edited", "applied"]) {
      // Low pct + no evidence, but a human signed off → verified.
      expect(fieldProvenance(10, status, false)).toBe("verified");
    }
  });

  it("is UNCERTAIN whenever there is no evidence, even at high confidence", () => {
    expect(fieldProvenance(99, "pending", false)).toBe("uncertain");
  });

  it("bands evidence-backed pending fields at the documented thresholds", () => {
    // 85 boundary → verified; 84 → inferred.
    expect(fieldProvenance(85, "pending", true)).toBe("verified");
    expect(fieldProvenance(84, "pending", true)).toBe("inferred");
    // 65 boundary → inferred; 64 → uncertain.
    expect(fieldProvenance(65, "pending", true)).toBe("inferred");
    expect(fieldProvenance(64, "pending", true)).toBe("uncertain");
  });

  it("rejected fields ride the confidence path (not human-confirmed)", () => {
    expect(fieldProvenance(90, "rejected", true)).toBe("verified");
    expect(fieldProvenance(50, "rejected", true)).toBe("uncertain");
  });

  it("has display text for every label", () => {
    expect(PROVENANCE_LABEL_TEXT.verified).toBe("Verified");
    expect(PROVENANCE_LABEL_TEXT.inferred).toBe("Inferred");
    expect(PROVENANCE_LABEL_TEXT.uncertain).toBe("Uncertain");
  });
});

describe("claimProvenance", () => {
  const baseClaim = (over: Partial<BriefClaim>): BriefClaim => ({
    key: "recommended_action",
    statement: "x",
    engine: "deterministic",
    confidencePct: 90,
    evidence: [
      { source: "charge_history", detail: "d", quote: null, refId: null },
    ],
    ...over,
  });

  it("is VERIFIED for a high-confidence claim with evidence", () => {
    expect(claimProvenance(baseClaim({ confidencePct: 90 }))).toBe("verified");
  });

  it("is INFERRED in the mid band", () => {
    expect(claimProvenance(baseClaim({ confidencePct: 70 }))).toBe("inferred");
  });

  it("is UNCERTAIN when a claim somehow carries no evidence", () => {
    expect(claimProvenance(baseClaim({ confidencePct: 95, evidence: [] }))).toBe(
      "uncertain"
    );
  });
});

describe("computeMissingInfo", () => {
  const fullSaas: RenewalItemFacts = {
    category: "saas_subscription",
    termEndDate: "2026-12-01",
    noticePeriodDays: 30,
    totalCostPerPeriodCents: 12_000_00,
    cancellationMethodCode: "email",
    priceIncreaseClauseText: "5% annual cap",
    attributes: {},
  };

  it("returns nothing when every universal fact is present (SaaS)", () => {
    expect(computeMissingInfo(fullSaas)).toEqual([]);
  });

  it("flags each absent universal fact as MISSING", () => {
    const bare: RenewalItemFacts = {
      category: "saas_subscription",
      termEndDate: null,
      noticePeriodDays: 0,
      totalCostPerPeriodCents: 0,
      cancellationMethodCode: null,
      priceIncreaseClauseText: null,
      attributes: {},
    };
    const keys = computeMissingInfo(bare).map((m) => m.key);
    expect(keys).toContain("renewal_date");
    expect(keys).toContain("notice_period_days");
    expect(keys).toContain("contract_value_cents");
    expect(keys).toContain("cancellation_method");
    expect(keys).toContain("price_increase_clause");
    expect(computeMissingInfo(bare).every((m) => m.reason === "missing")).toBe(
      true
    );
  });

  it("downgrades MISSING to UNCERTAIN when a low-confidence field exists", () => {
    const noDate: RenewalItemFacts = { ...fullSaas, termEndDate: null };
    const out = computeMissingInfo(noDate, [
      { fieldKey: "renewal_date", isUncertain: true },
    ]);
    const dateRow = out.find((m) => m.key === "renewal_date");
    expect(dateRow?.reason).toBe("uncertain");
  });

  it("labels the date 'Expiry date' for non-SaaS obligations", () => {
    const cert: RenewalItemFacts = {
      ...fullSaas,
      category: "compliance_cert",
      termEndDate: null,
    };
    const dateRow = computeMissingInfo(cert).find(
      (m) => m.key === "renewal_date"
    );
    expect(dateRow?.label).toBe("Expiry date");
  });

  it("asks for issuer + reference number only on non-SaaS obligations", () => {
    const saasKeys = computeMissingInfo(fullSaas).map((m) => m.key);
    expect(saasKeys).not.toContain("issuer");
    expect(saasKeys).not.toContain("reference_number");

    const policy: RenewalItemFacts = {
      ...fullSaas,
      category: "insurance_policy",
      attributes: {},
    };
    const policyKeys = computeMissingInfo(policy).map((m) => m.key);
    expect(policyKeys).toContain("issuer");
    expect(policyKeys).toContain("reference_number");
  });

  it("omits issuer/reference once present in attributes", () => {
    const policy: RenewalItemFacts = {
      ...fullSaas,
      category: "insurance_policy",
      attributes: { issuer: "Acme Insurance", referenceNumber: "POL-1" },
    };
    const keys = computeMissingInfo(policy).map((m) => m.key);
    expect(keys).not.toContain("issuer");
    expect(keys).not.toContain("reference_number");
  });
});

describe("extractableFieldsNotPresent (document-centric)", () => {
  it("lists every core field when the document yielded none", () => {
    expect(extractableFieldsNotPresent([]).map((f) => f.key)).toEqual([
      "renewal_date",
      "notice_period_days",
      "contract_value_cents",
      "cancellation_method",
      "price_increase_clause",
    ]);
  });

  it("returns empty when all core fields are present", () => {
    expect(
      extractableFieldsNotPresent([
        "renewal_date",
        "notice_period_days",
        "contract_value_cents",
        "cancellation_method",
        "price_increase_clause",
      ])
    ).toEqual([]);
  });

  it("treats expiry_date as satisfying the date slot", () => {
    const keys = extractableFieldsNotPresent(["expiry_date"]).map((f) => f.key);
    expect(keys).not.toContain("renewal_date");
  });
});
