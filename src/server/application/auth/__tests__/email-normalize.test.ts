/**
 * Email normalization tests for free-tier abuse dedup.
 *
 * The hard requirement: `user+1@gmail.com`, `user+2@gmail.com`, and
 * `user@gmail.com` MUST collapse to the same key. Without that, every
 * Gmail user gets unlimited free accounts.
 *
 * The conservative requirement: non-Gmail providers should NOT have
 * their `+` tags stripped — corporate providers often use `+` for
 * legitimate routing where two different users genuinely live.
 */
import { describe, expect, it } from "vitest";
import {
  emailDomain,
  normalizeEmailForDedup,
} from "@server/application/auth/email-normalize";

describe("normalizeEmailForDedup — Gmail rules", () => {
  it("collapses + tag variants", () => {
    expect(normalizeEmailForDedup("user+1@gmail.com")).toBe("user@gmail.com");
    expect(normalizeEmailForDedup("user+work@gmail.com")).toBe(
      "user@gmail.com"
    );
  });

  it("strips dots from the local part", () => {
    expect(normalizeEmailForDedup("u.s.e.r@gmail.com")).toBe("user@gmail.com");
    expect(normalizeEmailForDedup("john.doe@gmail.com")).toBe(
      "johndoe@gmail.com"
    );
  });

  it("combines dot + tag stripping", () => {
    expect(normalizeEmailForDedup("j.doe+work@gmail.com")).toBe(
      "jdoe@gmail.com"
    );
  });

  it("treats googlemail.com as gmail.com", () => {
    expect(normalizeEmailForDedup("user+x@googlemail.com")).toBe(
      "user@gmail.com"
    );
  });

  it("lowercases", () => {
    expect(normalizeEmailForDedup("USER@Gmail.COM")).toBe("user@gmail.com");
  });
});

describe("normalizeEmailForDedup — non-Gmail rules", () => {
  it("lowercases but does NOT strip + tags", () => {
    expect(normalizeEmailForDedup("User+work@Acme.com")).toBe(
      "user+work@acme.com"
    );
  });

  it("does NOT strip dots", () => {
    expect(normalizeEmailForDedup("john.doe@acme.com")).toBe(
      "john.doe@acme.com"
    );
  });

  it("strips whitespace", () => {
    expect(normalizeEmailForDedup("  user@acme.com  ")).toBe(
      "user@acme.com"
    );
  });
});

describe("normalizeEmailForDedup — degenerate input", () => {
  it("returns the lowercased input when no @ sign present", () => {
    expect(normalizeEmailForDedup("notanemail")).toBe("notanemail");
  });

  it("returns the lowercased input when @ at start", () => {
    expect(normalizeEmailForDedup("@nothing")).toBe("@nothing");
  });

  it("returns the lowercased input when @ at end", () => {
    expect(normalizeEmailForDedup("nothing@")).toBe("nothing@");
  });
});

describe("emailDomain", () => {
  it("returns the lowercased domain", () => {
    expect(emailDomain("User@Acme.com")).toBe("acme.com");
  });

  it("returns empty string for malformed input", () => {
    expect(emailDomain("noatsign")).toBe("");
  });
});
