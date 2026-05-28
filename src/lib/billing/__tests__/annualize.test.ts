import { describe, expect, it } from "vitest";
import { annualizeCents } from "@/lib/billing/annualize";

describe("annualizeCents", () => {
  it("multiplies monthly by 12", () => {
    expect(annualizeCents(10_000, "monthly")).toBe(120_000);
  });
  it("multiplies quarterly by 4", () => {
    expect(annualizeCents(25_000, "quarterly")).toBe(100_000);
  });
  it("passes annual through unchanged", () => {
    expect(annualizeCents(100_000, "annual")).toBe(100_000);
  });
  it("treats multi_year the same as annual at this layer", () => {
    expect(annualizeCents(100_000, "multi_year")).toBe(100_000);
  });
  it("falls back to identity on unknown cycles", () => {
    expect(annualizeCents(100_000, "weird-future-cycle")).toBe(100_000);
  });
  it("preserves zero", () => {
    expect(annualizeCents(0, "monthly")).toBe(0);
  });
});
