import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "@/lib/crypto/envelope";

const ACCOUNT_A = "00000000-0000-0000-0000-00000000aaaa";
const ACCOUNT_B = "00000000-0000-0000-0000-00000000bbbb";

describe("envelope encryption", () => {
  it("roundtrips a JSON blob", () => {
    const value = { webhookUrl: "https://hooks.slack.com/services/X/Y/Z" };
    const ct = encryptJson(ACCOUNT_A, value);
    expect(ct.split(".").length).toBe(3);
    const back = decryptJson<typeof value>(ACCOUNT_A, ct);
    expect(back).toEqual(value);
  });

  it("ciphertext for the same plaintext is non-deterministic (fresh IV)", () => {
    const value = { token: "abc" };
    const a = encryptJson(ACCOUNT_A, value);
    const b = encryptJson(ACCOUNT_A, value);
    expect(a).not.toBe(b);
  });

  it("ciphertext from account A cannot be decrypted with account B's scope", () => {
    const ct = encryptJson(ACCOUNT_A, { x: 1 });
    expect(() => decryptJson(ACCOUNT_B, ct)).toThrow();
  });

  it("tampered ciphertext throws on auth", () => {
    const ct = encryptJson(ACCOUNT_A, { x: 1 });
    // Flip the FIRST char of the ciphertext segment — that byte is always
    // part of the encrypted payload regardless of base64 alignment.
    const parts = ct.split(".");
    const original = parts[2]!;
    const flipped = (original[0] === "A" ? "B" : "A") + original.slice(1);
    const tampered = `${parts[0]}.${parts[1]}.${flipped}`;
    expect(() => decryptJson(ACCOUNT_A, tampered)).toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => decryptJson(ACCOUNT_A, "not.a.valid.ciphertext")).toThrow();
    expect(() => decryptJson(ACCOUNT_A, "abc")).toThrow();
  });
});
