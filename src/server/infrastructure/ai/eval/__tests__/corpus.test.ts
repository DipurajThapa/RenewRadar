/**
 * Corpus generator — deterministic, ground-truth-labeled, multi-variant.
 */
import { describe, expect, it } from "vitest";
import { generateCorpus } from "../corpus";

describe("generateCorpus", () => {
  it("is deterministic for a given seed", () => {
    const a = generateCorpus(1337, 12);
    const b = generateCorpus(1337, 12);
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    const a = generateCorpus(1, 8);
    const b = generateCorpus(2, 8);
    expect(a).not.toEqual(b);
  });

  it("covers all four variants", () => {
    const c = generateCorpus(7, 8);
    const variants = new Set(c.map((x) => x.variant));
    expect(variants).toEqual(
      new Set(["clean", "ocr_noise", "multilingual", "adversarial"])
    );
  });

  it("labels every contract with valid, complete truth", () => {
    for (const c of generateCorpus(99, 16)) {
      expect(c.truth.renewal_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.truth.notice_period_days).toBeGreaterThanOrEqual(1);
      expect(c.truth.notice_period_days).toBeLessThanOrEqual(365);
      expect(typeof c.truth.auto_renewal).toBe("boolean");
      expect(c.truth.contract_value_cents).toBeGreaterThan(0);
    }
  });

  it("multilingual contracts use a non-English language", () => {
    for (const c of generateCorpus(3, 16).filter((x) => x.variant === "multilingual")) {
      expect(["es", "fr", "de"]).toContain(c.language);
    }
  });

  it("adversarial contracts carry traps whose decoys are NOT the truth", () => {
    const adv = generateCorpus(5, 16).filter((x) => x.variant === "adversarial");
    expect(adv.length).toBeGreaterThan(0);
    for (const c of adv) {
      expect(c.traps.length).toBeGreaterThan(0);
      // The injected decoy "999 days" is in the text but must never equal truth.
      expect(c.text).toContain("999");
      expect(c.truth.notice_period_days).not.toBe(999);
      const noticeTrap = c.traps.find((t) => t.fieldKey === "notice_period_days");
      expect(noticeTrap?.forbiddenValue).toBe(999);
    }
  });

  it("non-adversarial contracts have no traps", () => {
    for (const c of generateCorpus(11, 12).filter((x) => x.variant !== "adversarial")) {
      expect(c.traps).toHaveLength(0);
    }
  });
});
