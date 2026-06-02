/**
 * Bounded-concurrency queue (Phase B/B4) for model calls.
 *
 * On a SINGLE GPU, N concurrent generations share the same compute, so each runs
 * ~N× slower — a burst of 4 turned a 16s brief into 50–65s (measured). Capping
 * in-flight calls (LLM_MAX_CONCURRENCY) lets each request run at FULL GPU speed and
 * the rest QUEUE, giving predictable per-op latency instead of pathological
 * contention. A served multi-replica deployment raises the cap to its replica count.
 *
 * Cap ≤ 0 = unlimited (the default — preserves prior behavior; opt in to bound).
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.max <= 0) return fn(); // unlimited — no queueing
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) =>
      this.waiters.push(() => {
        this.active++;
        resolve();
      })
    );
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  /** Test/telemetry: current in-flight + queued counts. */
  stats(): { active: number; queued: number; max: number } {
    return { active: this.active, queued: this.waiters.length, max: this.max };
  }
}

const registry = new Map<string, Semaphore>();

/** Per-endpoint shared semaphore; cap from LLM_MAX_CONCURRENCY (0 = unlimited). */
export function getSemaphore(key: string): Semaphore {
  let s = registry.get(key);
  if (!s) {
    const max = Number(process.env.LLM_MAX_CONCURRENCY ?? 0);
    s = new Semaphore(Number.isFinite(max) ? max : 0);
    registry.set(key, s);
  }
  return s;
}

export function _resetSemaphoresForTests(): void {
  registry.clear();
}
