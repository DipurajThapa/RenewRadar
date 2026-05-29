/**
 * Pure-function tests for vendor-portal internals — no DB required.
 */
import { describe, expect, it } from "vitest";
import {
  displayNameFromDomain,
  extractDomain,
  generateOpaqueToken,
  hashToken,
  isPersonalEmailDomain,
  isValidEmailShape,
  normalizeEmail,
  slugFromDomain,
  timingSafeHashEqual,
  truncateIp,
  truncateUserAgent,
} from "@server/application/vendor-portal/internals";

describe("isValidEmailShape", () => {
  it.each([
    ["a@b.co", true],
    ["foo.bar+tag@sub.example.com", true],
    ["spaces here@x.com", false],
    ["no-at-sign", false],
    ["trailing@", false],
    ["@no-local.io", false],
    ["a@b", false],
  ])("%s → %s", (input, expected) => {
    expect(isValidEmailShape(input)).toBe(expected);
  });

  it("refuses pathologically long emails (> 254 chars)", () => {
    // RFC 5321 caps the full address at 254 chars; we enforce the same.
    const long = "a".repeat(260) + "@b.co"; // 265 chars total
    expect(isValidEmailShape(long)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Alice@Vendor.IO  ")).toBe("alice@vendor.io");
  });
});

describe("extractDomain", () => {
  it("returns lowercased domain", () => {
    expect(extractDomain("alice@VENDOR.IO")).toBe("vendor.io");
  });
  it("handles subdomains", () => {
    expect(extractDomain("alice@a.b.c.io")).toBe("a.b.c.io");
  });
  it("throws on bad input", () => {
    expect(() => extractDomain("missing")).toThrow();
    expect(() => extractDomain("alice@")).toThrow();
  });
});

describe("isPersonalEmailDomain", () => {
  it.each([
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "icloud.com",
    "protonmail.com",
  ])("flags %s", (domain) => {
    expect(isPersonalEmailDomain(domain)).toBe(true);
  });
  it.each(["acme.com", "vendor.io", "notion.so"])(
    "does not flag %s",
    (domain) => {
      expect(isPersonalEmailDomain(domain)).toBe(false);
    }
  );
});

describe("slugFromDomain", () => {
  it.each([
    ["acme.com", "acme-com"],
    ["foo.bar.io", "foo-bar-io"],
    ["a--b.io", "a-b-io"],
    ["..weird..io..", "weird-io"],
  ])("%s → %s", (input, expected) => {
    expect(slugFromDomain(input)).toBe(expected);
  });
  it("caps at 60 chars", () => {
    const long = "a".repeat(80) + ".io";
    expect(slugFromDomain(long).length).toBeLessThanOrEqual(60);
  });
});

describe("displayNameFromDomain", () => {
  it("Title-cases the first label", () => {
    expect(displayNameFromDomain("acme.com")).toBe("Acme");
    expect(displayNameFromDomain("vendor.io")).toBe("Vendor");
  });
  it("handles single-label fallback", () => {
    expect(displayNameFromDomain("nope")).toBe("Nope");
  });
});

describe("generateOpaqueToken", () => {
  it("returns 64 hex chars", () => {
    expect(generateOpaqueToken()).toMatch(/^[0-9a-f]{64}$/);
  });
  it("returns a different value each call", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
  });
});

describe("hashToken", () => {
  it("is stable for the same input", () => {
    const t = "deadbeef".repeat(8);
    expect(hashToken(t)).toBe(hashToken(t));
  });
  it("returns 64 hex chars", () => {
    expect(hashToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("timingSafeHashEqual", () => {
  it("returns true for equal inputs", () => {
    const a = hashToken("foo");
    const b = hashToken("foo");
    expect(timingSafeHashEqual(a, b)).toBe(true);
  });
  it("returns false for different inputs", () => {
    expect(timingSafeHashEqual(hashToken("a"), hashToken("b"))).toBe(false);
  });
  it("returns false for different lengths", () => {
    expect(timingSafeHashEqual("abc", "abcd")).toBe(false);
  });
});

describe("truncateUserAgent / truncateIp", () => {
  it("truncates user-agent at 200 chars", () => {
    const ua = "x".repeat(500);
    expect(truncateUserAgent(ua)?.length).toBe(200);
  });
  it("truncates IP at 64 chars", () => {
    const ip = "1.".repeat(200);
    expect(truncateIp(ip)?.length).toBe(64);
  });
  it("preserves null/undefined", () => {
    expect(truncateUserAgent(null)).toBeNull();
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateIp(null)).toBeNull();
  });
});
