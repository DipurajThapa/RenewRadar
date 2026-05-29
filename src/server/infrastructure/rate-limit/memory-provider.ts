/**
 * In-memory rate-limit provider.
 *
 * Fixed-window counter keyed by (key + window-start). Per-process — fine for
 * dev and adequate for single-instance production deployments. Multi-instance
 * production needs the Upstash provider (swap via getRateLimit factory).
 */
import type {
  RateLimitConfig,
  RateLimitDecision,
  RateLimitProvider,
} from "./types";

type Bucket = {
  count: number;
  windowEndsAt: number; // ms epoch
};

export class MemoryRateLimitProvider implements RateLimitProvider {
  readonly providerName = "memory";
  /** key → bucket. Cleared lazily; pruned when a key's bucket has expired. */
  private buckets = new Map<string, Bucket>();

  async check(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;
    const existing = this.buckets.get(key);

    // Either no bucket, or the window expired → start fresh.
    if (!existing || existing.windowEndsAt <= now) {
      const windowEndsAt = now + windowMs;
      this.buckets.set(key, { count: 1, windowEndsAt });
      return {
        allowed: true,
        remaining: Math.max(0, config.limit - 1),
        resetSeconds: Math.ceil(windowMs / 1000),
        limit: config.limit,
      };
    }

    // Window still open — increment + check.
    existing.count += 1;
    const remaining = Math.max(0, config.limit - existing.count);
    const resetSeconds = Math.max(
      0,
      Math.ceil((existing.windowEndsAt - now) / 1000)
    );
    return {
      allowed: existing.count <= config.limit,
      remaining,
      resetSeconds,
      limit: config.limit,
    };
  }

  /** Test-only: nuke all state. */
  reset(): void {
    this.buckets.clear();
  }
}
