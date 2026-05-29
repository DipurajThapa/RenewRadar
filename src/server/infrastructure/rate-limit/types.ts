/**
 * Rate limiter provider interface.
 *
 * Pluggable so the in-memory dev implementation can swap out for an
 * Upstash / Vercel-KV implementation in production without touching the
 * callsites. The interface is intentionally minimal: a fixed-window
 * counter is enough to defend the surfaces we care about (lead capture,
 * ICS feed, webhook unsigned hammering).
 *
 * Token-bucket semantics + cross-instance coordination are explicitly
 * out of scope for V1 — the in-memory impl is per-process, the Upstash
 * impl will be cluster-wide.
 */
export type RateLimitDecision = {
  /** True if the request is allowed; false if the limit is exhausted. */
  allowed: boolean;
  /** How many requests remain in the current window. 0 on denied. */
  remaining: number;
  /** Seconds until the window resets — surface as Retry-After header. */
  resetSeconds: number;
  /** The configured limit for context in logs / 429 bodies. */
  limit: number;
};

export type RateLimitConfig = {
  /** Number of requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export interface RateLimitProvider {
  /** Implementation name for diagnostics — "memory", "upstash", etc. */
  readonly providerName: string;

  /**
   * Atomically check + decrement for `key` in `config`'s window.
   *
   * Implementations MUST NOT throw for "limit exceeded" — that's encoded
   * as `allowed: false` in the return. They MAY throw for adapter failures
   * (network, etc.); callers should fail-open in production (allow on
   * adapter failure) since blocking real users on a rate-limiter glitch
   * is worse than the threat model.
   */
  check(key: string, config: RateLimitConfig): Promise<RateLimitDecision>;
}
