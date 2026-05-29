/**
 * Vendor name normalization tests.
 *
 * The normalizer must collapse all "the same vendor" variants the wild
 * uses — case, whitespace, punctuation, corporate suffixes — to a single
 * key so the cross-account aggregator finds a meaningful sample.
 *
 * It must also DEGRADE GRACEFULLY on degenerate input (empty, suffix-only)
 * so we never disclose a benchmark for "Inc" or "" — those would aggregate
 * across vendor types and leak info.
 */
import { describe, expect, it } from "vitest";
import { normalizeVendorName } from "@server/application/vendor-benchmarks/normalize";

describe("normalizeVendorName", () => {
  it("lowercases", () => {
    expect(normalizeVendorName("Atlassian")).toBe("atlassian");
  });

  it("strips trailing whitespace", () => {
    expect(normalizeVendorName(" Atlassian ")).toBe("atlassian");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeVendorName("Hubspot   Marketing")).toBe("hubspot marketing");
  });

  it("strips punctuation", () => {
    expect(normalizeVendorName("Atlassian, Inc.")).toBe("atlassian");
  });

  it("strips Inc suffix", () => {
    expect(normalizeVendorName("Atlassian Inc")).toBe("atlassian");
  });

  it("strips LLC suffix", () => {
    expect(normalizeVendorName("Notion Labs LLC")).toBe("notion labs");
  });

  it("strips Ltd suffix", () => {
    expect(normalizeVendorName("Canva Pty Ltd")).toBe("canva pty");
  });

  it("strips multi-pass suffixes (Foo Inc. LLC)", () => {
    expect(normalizeVendorName("Foo Inc LLC")).toBe("foo");
  });

  it("returns empty for null/undefined/empty input", () => {
    expect(normalizeVendorName(null)).toBe("");
    expect(normalizeVendorName(undefined)).toBe("");
    expect(normalizeVendorName("")).toBe("");
    expect(normalizeVendorName("   ")).toBe("");
  });

  it("returns empty for input that is only a corporate suffix (degenerate)", () => {
    expect(normalizeVendorName("Inc")).toBe("");
    expect(normalizeVendorName("LLC")).toBe("");
    expect(normalizeVendorName("Ltd.")).toBe("");
  });

  it("collapses common variants of the same vendor to the same key", () => {
    const variants = [
      "Atlassian",
      "atlassian",
      "Atlassian ",
      "Atlassian, Inc.",
      "Atlassian Inc",
      "ATLASSIAN LLC",
    ];
    const keys = new Set(variants.map(normalizeVendorName));
    expect(keys.size).toBe(1);
    expect(keys.has("atlassian")).toBe(true);
  });

  it("does NOT collapse different vendors with the same suffix", () => {
    const notion = normalizeVendorName("Notion Inc");
    const figma = normalizeVendorName("Figma Inc");
    expect(notion).toBe("notion");
    expect(figma).toBe("figma");
    expect(notion).not.toBe(figma);
  });

  it("handles unicode/non-ASCII gracefully (strips them, doesn't crash)", () => {
    // The strip rule is `[^a-z0-9 ]+` after lowercase, so non-ASCII falls
    // out. Real-world fix is to keep unicode letters; for now we accept
    // the simplification — most enterprise vendor names are ASCII.
    expect(normalizeVendorName("Atlässian")).toBe("atl ssian");
  });
});
