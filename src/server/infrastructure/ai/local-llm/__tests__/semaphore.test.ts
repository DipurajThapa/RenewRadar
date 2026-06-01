/**
 * Bounded-concurrency queue (B4) — caps in-flight model calls so a burst queues
 * instead of all requests contending for one GPU. Pure semaphore + the client
 * wiring (LLM_MAX_CONCURRENCY).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Semaphore, _resetSemaphoresForTests } from "../semaphore";
import { LocalLlmClient } from "../client";
import { _resetBreakersForTests } from "../breaker";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function maxConcurrency(sem: Semaphore, tasks: number): Promise<number> {
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: tasks }, () =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await delay(10);
        active--;
      })
    )
  );
  return peak;
}

describe("Semaphore", () => {
  it("caps concurrent runs at `max`", async () => {
    expect(await maxConcurrency(new Semaphore(1), 4)).toBe(1);
    expect(await maxConcurrency(new Semaphore(2), 5)).toBe(2);
  });

  it("max <= 0 means unlimited (no queueing)", async () => {
    expect(await maxConcurrency(new Semaphore(0), 4)).toBe(4);
  });

  it("runs every task exactly once even when capped", async () => {
    const sem = new Semaphore(1);
    const done: number[] = [];
    await Promise.all([1, 2, 3].map((n) => sem.run(async () => { done.push(n); })));
    expect(done.sort()).toEqual([1, 2, 3]);
  });
});

describe("LocalLlmClient honours LLM_MAX_CONCURRENCY", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    _resetBreakersForTests();
    _resetSemaphoresForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_MAX_CONCURRENCY;
    _resetSemaphoresForTests();
  });

  it("serializes model calls when the cap is 1 (burst queues, no contention)", async () => {
    process.env.LLM_MAX_CONCURRENCY = "1";
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(15);
      inFlight--;
      return { ok: true, status: 200, json: async () => ({ message: { content: "{}" } }), text: async () => "" };
    });
    const client = new LocalLlmClient({ apiStyle: "ollama", baseUrl: "http://localhost:11434" });
    await Promise.all([1, 2, 3].map(() => client.chatJson({ system: "s", user: "u" })));
    expect(peak).toBe(1); // never two model calls in flight at once
  });
});
