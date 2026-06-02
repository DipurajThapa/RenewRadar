/**
 * Pure helpers for the vendor portal auth flow. Kept separate from the
 * top-level use cases so they can be unit-tested without a DB.
 */
import crypto from "node:crypto";

/** Magic link TTL — short on purpose. */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Session TTL — anchored, no sliding extension. Sign in again after 7 days. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Maximum tokens we'll issue per (vendor_user, hour) before rate-limiting. */
export const MAX_MAGIC_LINKS_PER_HOUR = 5;

/** Cookie name carrying the raw session token. */
export const VENDOR_SESSION_COOKIE = "__rr_vendor_session";

/**
 * Free-email providers we refuse for vendor signup. The vendor portal is for
 * companies pushing announcements to their customers; a personal Gmail is
 * almost always either a mistake or a spam attempt. Not exhaustive — Slice 5
 * will add a heuristic + admin block list.
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "msn.com",
  "mail.com",
  "gmx.com",
  "zoho.com",
  "yandex.com",
]);

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Loose RFC-compliant-ish email check. We only really need to refuse
 * obviously-malformed input — the source of truth for "is this address
 * reachable" is the magic-link round-trip.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function isValidEmailShape(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function extractDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) {
    throw new Error("Email has no domain part");
  }
  return email.slice(at + 1).toLowerCase();
}

/**
 * Slug from a domain: "Acme Corp.io" → "acme-corp-io".
 * Strips anything that isn't alphanumeric, collapses runs of separators
 * to single hyphens, trims edges.
 */
export function slugFromDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Display name from a domain: "acme.com" → "Acme", "globex-corp.com" →
 * "Globex Corp", "blue_sky.io" → "Blue Sky". Takes the first label, splits on
 * hyphen/underscore/dot, Title-cases each token, and joins with a space so
 * vendors don't open the portal greeted by "Globex-corp". Vendors edit this
 * during onboarding (Slice 2); the default just needs to read cleanly.
 */
export function displayNameFromDomain(domain: string): string {
  const parts = domain.split(".");
  // For "foo.co.uk" we want "Foo"; for "acme.com" we want "Acme"; the
  // first label is correct in both cases.
  const label = parts[0] ?? domain;
  if (!label) return domain;
  const tokens = label.split(/[-_]+/).filter(Boolean);
  if (tokens.length === 0) return domain;
  return tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(" ");
}

/** 32 random bytes → 64 hex chars. Cryptographically secure. */
export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** SHA-256 hex of the input. Lookup index target. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Timing-safe equality check. Used when comparing two hex hashes; both
 * inputs are the same length (64 chars) so we can use Node's primitive.
 */
export function timingSafeHashEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Truncate user-agent so DB rows stay small even with absurd headers. */
export function truncateUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.slice(0, 200);
}

/** Truncate IP (handles IPv6 + the rare X-Forwarded-For chain). */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return ip.slice(0, 64);
}

/**
 * Extract a bare domain from a customer-entered website string. Handles
 * "https://www.acme.com/pricing" → "acme.com", "Acme.COM" → "acme.com".
 * Returns null when nothing domain-like is present.
 *
 * Used by T4.10 Slice 3 to match a customer's vendor row to a verified
 * vendor_org by domain.
 */
export function domainFromWebsite(
  website: string | null | undefined
): string | null {
  if (!website) return null;
  let s = website.trim().toLowerCase();
  if (!s) return null;
  // Strip protocol.
  s = s.replace(/^[a-z]+:\/\//, "");
  // Strip path / query / port.
  s = s.split("/")[0]!.split("?")[0]!.split(":")[0]!;
  // Strip leading www.
  s = s.replace(/^www\./, "");
  // Must look like a domain (has a dot, valid chars).
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

/**
 * Normalize a vendor/company name for loose equality matching:
 * lowercase, strip common corporate suffixes + punctuation + spaces.
 * "Acme Corp, Inc." and "acme corp" → "acmecorp".
 */
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh|sa|plc|company)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}
