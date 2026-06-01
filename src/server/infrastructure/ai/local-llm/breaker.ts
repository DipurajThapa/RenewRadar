/**
 * Circuit breaker (Phase 4, B4) — stops the AI path from hammering a downed model.
 *
 * Without it, every call to an unreachable model waits out the full request
 * timeout before the provider falls back to deterministic — turning a model
 * outage into a site-wide latency cliff. The breaker trips after N consecutive
 * failures and fast-fails (so the per-call fallback fires immediately); after a
 * cooldown it allows a trial (half-open); a success closes it.
 *
 * Breakers are shared per endpoint, so all clients to a downed server fast-fail.
 */
export type BreakerState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** May a request proceed? Open + within cooldown → false (fast-fail). */
  allow(): boolean {
    if (this.failures < this.threshold) return true;
    // Open: permit a single trial once the cooldown has elapsed (half-open).
    return this.now() - this.openedAt >= this.cooldownMs;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
  }

  recordFailure(): void {
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  state(): BreakerState {
    if (this.failures < this.threshold) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half_open" : "open";
  }
}

const registry = new Map<string, CircuitBreaker>();

export function getBreaker(key: string): CircuitBreaker {
  let b = registry.get(key);
  if (!b) {
    b = new CircuitBreaker();
    registry.set(key, b);
  }
  return b;
}

export function _resetBreakersForTests(): void {
  registry.clear();
}
