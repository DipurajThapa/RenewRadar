/**
 * Rate limit provider factory.
 *
 * Defaults to the in-memory provider. The Upstash adapter swaps in when the
 * UPSTASH_* env vars are set (V1.5 — interface is stable, adapter not yet
 * built). The factory caches a single instance so per-process state is
 * preserved across requests.
 */
import { MemoryRateLimitProvider } from "./memory-provider";
import type { RateLimitProvider } from "./types";

let cached: RateLimitProvider | null = null;

export function getRateLimit(): RateLimitProvider {
  if (cached) return cached;
  cached = new MemoryRateLimitProvider();
  return cached;
}

/** Test-only: drop the cached instance so a test can swap providers. */
export function _resetRateLimitForTests(provider?: RateLimitProvider): void {
  cached = provider ?? null;
}

export type { RateLimitDecision, RateLimitConfig, RateLimitProvider } from "./types";
export { MemoryRateLimitProvider };

// ─────────────────────────────────────────────────────────────────────────
// Standard policies — defined once so callsites can't drift.
// ─────────────────────────────────────────────────────────────────────────

/** Lead capture: 5 submissions per IP per minute. */
export const LEAD_CAPTURE_POLICY = {
  limit: 5,
  windowSeconds: 60,
} as const;

/** ICS calendar feed: 30 fetches per token per minute (calendar clients poll). */
export const ICS_FEED_POLICY = {
  limit: 30,
  windowSeconds: 60,
} as const;

/** Document upload: 10 per user per 5 minutes (defends against scripted abuse). */
export const DOCUMENT_UPLOAD_POLICY = {
  limit: 10,
  windowSeconds: 300,
} as const;

/**
 * On-demand spend-feed sync: 6 per account per hour. The daily cron does the
 * routine work; this only guards the manual "Sync now" button so a user can't
 * hammer ingest+detect (CPU + future Ramp API cost) in a tight loop (REV-5).
 */
export const SPEND_SYNC_POLICY = {
  limit: 6,
  windowSeconds: 3600,
} as const;

/**
 * Renewal-brief generation: 5 per account+subscription per 10 minutes. Stops a
 * "Regenerate" loop from stacking briefs (and, once the LLM provider is live,
 * from burning tokens) while leaving room for a few legitimate re-runs (REV-3).
 */
export const BRIEF_GENERATION_POLICY = {
  limit: 5,
  windowSeconds: 600,
} as const;

/**
 * Vendor magic-link request: 10 per IP per 10 minutes. Catches scripted
 * email-harvesting from the sign-in form. The application layer also
 * enforces a per-user cap (5/hr) so a single attacker email can't be
 * spammed even from many IPs.
 */
export const VENDOR_MAGIC_LINK_POLICY = {
  limit: 10,
  windowSeconds: 600,
} as const;
