/**
 * Response cache (B3) + circuit breaker (B4) — units + their integration into
 * the client (cache hit skips the model call; the breaker fast-fails a downed
 * endpoint instead of waiting out every timeout).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResponseCache, hashKey } from "../cache";
import { CircuitBreaker, _resetBreakersForTests } from "../breaker";
import { LocalLlmClient, LocalLlmError } from "../client";

describe("ResponseCache", () => {
  it("stores + serves, and counts hit rate", () => {
    const c = new ResponseCache(10, 1000, () => 0);
    expect(c.get("a")).toBeUndefined();
    c.set("a", "v");
    expect(c.get("a")).toBe("v");
    expect(c.stats().hits).toBe(1);
    expect(c.stats().misses).toBe(1);
    expect(c.stats().hitRatePct).toBe(50);
  });

  it("expires entries after the TTL", () => {
    let t = 0;
    const c = new ResponseCache(10, 100, () => t);
    c.set("a", "v");
    t = 50;
    expect(c.get("a")).toBe("v");
    t = 200; // past TTL
    expect(c.get("a")).toBeUndefined();
  });

  it("evicts the least-recently-used past maxSize", () => {
    const c = new ResponseCache(2, 10_000, () => 0);
    c.set("a", "1");
    c.set("b", "2");
    c.get("a"); // bump a → b is now LRU
    c.set("c", "3"); // evicts b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("1");
    expect(c.get("c")).toBe("3");
  });

  it("hashKey is stable + bounded", () => {
    expect(hashKey("hello")).toBe(hashKey("hello"));
    expect(hashKey("hello")).not.toBe(hashKey("world"));
  });
});

describe("CircuitBreaker", () => {
  it("opens after the threshold, fast-fails, then half-opens after cooldown", () => {
    let t = 0;
    const b = new CircuitBreaker(3, 1000, () => t);
    expect(b.allow()).toBe(true); // closed
    b.recordFailure();
    b.recordFailure();
    expect(b.allow()).toBe(true); // 2 < 3
    b.recordFailure(); // 3 → open
    expect(b.state()).toBe("open");
    expect(b.allow()).toBe(false); // fast-fail
    t = 1000; // cooldown elapsed
    expect(b.state()).toBe("half_open");
    expect(b.allow()).toBe(true); // trial permitted
    b.recordSuccess();
    expect(b.state()).toBe("closed");
    expect(b.allow()).toBe(true);
  });
});

describe("client integration", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    _resetBreakersForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("serves a cached response without a second model call", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"n":1}' } }),
      text: async () => "",
    });
    const client = new LocalLlmClient({
      apiStyle: "ollama",
      cacheEnabled: true,
      baseUrl: "http://cache.test",
    });
    const a = await client.chatJson({ system: "s", user: "u" });
    const b = await client.chatJson({ system: "s", user: "u" }); // identical → cache hit
    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("trips the breaker after repeated failures and fast-fails without a call", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "down" });
    const client = new LocalLlmClient({ apiStyle: "ollama", baseUrl: "http://down.test" });

    for (let i = 0; i < 5; i++) {
      await expect(client.chatJson({ system: "s", user: "u" })).rejects.toBeInstanceOf(LocalLlmError);
    }
    expect(fetchMock).toHaveBeenCalledTimes(5); // 5 real attempts

    // 6th: circuit is open → fast-fail, NO fetch.
    await expect(client.chatJson({ system: "s", user: "u" })).rejects.toThrow(/circuit open/);
    expect(fetchMock).toHaveBeenCalledTimes(5); // unchanged
  });
});
