/**
 * Response cache (Phase 4, B3) — an in-memory TTL + LRU cache for model JSON
 * responses, keyed on (apiStyle, model, system, user). At temperature 0 the model
 * is ~deterministic, and briefs are append-only snapshots, so identical inputs
 * (e.g. regenerating an unchanged brief) recur — a cache hit skips a multi-second
 * model call entirely. Opt-in via LLM_CACHE_ENABLED=true.
 *
 * Per-process (one cache per server instance). A multi-instance deployment would
 * back this with Redis behind the same get/set seam.
 */
export class ResponseCache {
  private readonly map = new Map<string, { value: string; exp: number }>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxSize = 500,
    private readonly ttlMs = 600_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  get(key: string): string | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    if (e.exp <= this.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // LRU bump: re-insert to mark as most-recently used.
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.value;
  }

  set(key: string, value: string): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, exp: this.now() + this.ttlMs });
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  stats(): { size: number; hits: number; misses: number; hitRatePct: number } {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRatePct: total === 0 ? 0 : Math.round((this.hits / total) * 100),
    };
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/** Cheap stable string hash (FNV-1a) so cache keys stay bounded. */
export function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
