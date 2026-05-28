/**
 * Symmetric envelope encryption for integration secrets.
 *
 * We encrypt small JSON blobs (Slack webhook URLs, ICS export tokens) with a
 * single account-scoped DEK derived from the master key. AES-256-GCM gives us
 * authenticated encryption — tampering produces a decryption error rather
 * than silent garbage.
 *
 * Master key: `INTEGRATIONS_ENCRYPTION_KEY` (32-byte base64 or hex). If not
 * set, we fall back to a development-only static key so demo mode works.
 * Production deployments MUST set it; the health check refuses to boot
 * without it when `NODE_ENV === "production"`.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96 bits — recommended for GCM
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (raw) {
    // Accept either base64 (typical) or hex
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
    try {
      const buf = Buffer.from(raw, "base64");
      if (buf.length === 32) return buf;
    } catch {
      // fall through
    }
    // Last resort: derive a 32-byte key from the input via scrypt so we still
    // boot with a weak key in dev; production should always provide raw bytes.
    return scryptSync(raw, "renewal-radar:integrations:v1", 32);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "INTEGRATIONS_ENCRYPTION_KEY must be set in production (32-byte base64)"
    );
  }
  // Dev/test fallback. Deterministic so tests are reproducible.
  return scryptSync("dev-only-key", "renewal-radar:integrations:v1", 32);
}

/**
 * Per-account DEK derivation. Mixing in the accountId ensures a leaked
 * ciphertext from one account cannot be decrypted with another account's
 * scope, defense-in-depth against a faulty query.
 */
function deriveAccountKey(accountId: string): Buffer {
  const master = getMasterKey();
  return scryptSync(master, `account:${accountId}`, 32);
}

/**
 * Encrypt a JSON-serializable value. The returned string is self-contained:
 *   `<iv-base64>.<tag-base64>.<ciphertext-base64>`
 */
export function encryptJson(accountId: string, value: unknown): string {
  const key = deriveAccountKey(accountId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

/**
 * Decrypt and parse a previously-encrypted blob. Throws on tampering, wrong
 * account, or malformed input — callers must handle the error.
 */
export function decryptJson<T>(accountId: string, ciphertext: string): T {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) throw new Error("Malformed ciphertext");
  const [ivPart, tagPart, encPart] = parts as [string, string, string];
  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const enc = Buffer.from(encPart, "base64");
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error("Malformed ciphertext (size mismatch)");
  }

  const key = deriveAccountKey(accountId);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
