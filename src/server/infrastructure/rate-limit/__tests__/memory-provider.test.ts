/**
 * Rate-limit in-memory provider tests.
 *
 * The interface is small but its semantics matter: a wrong reset window
 * means a real user gets 429'd, a wrong count means an attacker keeps
 * hammering. We test the four properties the route handlers rely on:
 *
 *   1. The first N requests are allowed (N = limit)
 *   2. The (N+1)th request is denied
 *   3. After the window expires, the next request is allowed again
 *   4. Keys are isolated (one IP's storm doesn't deny another's request)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRateLimitProvider } from "@server/infrastructure/rate-limit/memory-provider";

afterEach(() => {
  vi.useRealTimers();
});

describe("MemoryRateLimitProvider", () => {
  it("allows up to the limit and denies the next request", async () => {
    const limiter = new MemoryRateLimitProvider();
    const config = { limit: 3, windowSeconds: 60 };

    const r1 = await limiter.check("key-A", config);
    const r2 = await limiter.check("key-A", config);
    const r3 = await limiter.check("key-A", config);
    const r4 = await limiter.check("key-A", config);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.limit).toBe(3);
  });

  it("remaining counter decrements correctly", async () => {
    const limiter = new MemoryRateLimitProvider();
    const config = { limit: 5, windowSeconds: 60 };
    const first = await limiter.check("key", config);
    const second = await limiter.check("key", config);
    expect(first.remaining).toBe(4);
    expect(second.remaining).toBe(3);
  });

  it("isolates state per key", async () => {
    const limiter = new MemoryRateLimitProvider();
    const config = { limit: 2, windowSeconds: 60 };

    await limiter.check("ip-1", config);
    await limiter.check("ip-1", config);
    const denyForIp1 = await limiter.check("ip-1", config);
    const allowForIp2 = await limiter.check("ip-2", config);

    expect(denyForIp1.allowed).toBe(false);
    expect(allowForIp2.allowed).toBe(true);
  });

  it("resets after the window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const limiter = new MemoryRateLimitProvider();
    const config = { limit: 1, windowSeconds: 60 };

    const r1 = await limiter.check("key", config);
    const denied = await limiter.check("key", config);
    expect(r1.allowed).toBe(true);
    expect(denied.allowed).toBe(false);

    // Advance past the window.
    vi.setSystemTime(new Date("2026-06-15T12:01:01Z"));
    const r3 = await limiter.check("key", config);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0); // limit=1, just consumed
  });

  it("resetSeconds tracks remaining window time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const limiter = new MemoryRateLimitProvider();
    const config = { limit: 10, windowSeconds: 60 };

    const r1 = await limiter.check("key", config);
    expect(r1.resetSeconds).toBe(60);

    vi.setSystemTime(new Date("2026-06-15T12:00:30Z"));
    const r2 = await limiter.check("key", config);
    expect(r2.resetSeconds).toBeLessThanOrEqual(30);
    expect(r2.resetSeconds).toBeGreaterThanOrEqual(29);
  });

  it("reset() drops all state (test helper)", async () => {
    const limiter = new MemoryRateLimitProvider();
    const config = { limit: 1, windowSeconds: 60 };
    await limiter.check("key", config);
    const blocked = await limiter.check("key", config);
    expect(blocked.allowed).toBe(false);

    limiter.reset();
    const allowedAgain = await limiter.check("key", config);
    expect(allowedAgain.allowed).toBe(true);
  });
});
