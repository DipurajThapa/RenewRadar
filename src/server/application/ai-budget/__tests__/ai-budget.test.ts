/**
 * AI reasoning budget enforcement (F3) — the leak fix. Proves that an account
 * over its monthly cap is served the deterministic engine (no LLM call), while an
 * account under cap gets the configured engine, and that spend is recorded only
 * for completed LLM calls.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  _resetReasoningProviderForTests,
  _resetFallbackReasoningProviderForTests,
  getFallbackReasoningProvider,
} from "@server/infrastructure/ai";
import type { ReasoningProvider } from "@server/infrastructure/ai/reasoning/types";
import {
  recordReasoningSpend,
  resolveReasoningProvider,
} from "@server/application/ai-budget";
import {
  getMonthlyReasoningCostUsdMicros,
  recordReasoningUsage,
} from "@server/infrastructure/db/repositories/ai-reasoning-usage";

// A stand-in for the configured (LLM) provider — identity is all we check.
const FAKE_CONFIGURED = { providerName: "fake-llm" } as unknown as ReasoningProvider;
const FREE_CAP = 250_000; // tier-definitions free_forever aiReasoningUsdMicrosPerMonth

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  _resetReasoningProviderForTests(FAKE_CONFIGURED);
  _resetFallbackReasoningProviderForTests(null); // real deterministic fallback
});

afterEach(() => {
  _resetReasoningProviderForTests(null);
  _resetFallbackReasoningProviderForTests(null);
});

describe("resolveReasoningProvider (F3 enforcement)", () => {
  it("uses the configured engine when under the monthly cap", async () => {
    const d = await resolveReasoningProvider(ids.accountA.id);
    expect(d.withinBudget).toBe(true);
    expect(d.provider).toBe(FAKE_CONFIGURED);
    expect(d.usedUsdMicros).toBe(0);
    expect(d.capUsdMicros).toBe(FREE_CAP);
  });

  it("forces the deterministic engine when over the cap (no LLM call)", async () => {
    // Burn the whole free cap.
    await recordReasoningUsage({
      accountId: ids.accountA.id,
      surface: "brief",
      provider: "ollama",
      model: "qwen",
      promptTokens: 1000,
      completionTokens: 200,
      costUsdMicros: FREE_CAP,
    });
    const d = await resolveReasoningProvider(ids.accountA.id);
    expect(d.withinBudget).toBe(false);
    expect(d.provider).toBe(getFallbackReasoningProvider());
    expect(d.provider).not.toBe(FAKE_CONFIGURED);
    expect(d.usedUsdMicros).toBe(FREE_CAP);
  });

  it("never caps an enterprise (Infinity) account", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "enterprise" })
      .where(eq(accountsTable.id, ids.accountA.id));
    await recordReasoningUsage({
      accountId: ids.accountA.id,
      surface: "ask",
      provider: "ollama",
      model: "qwen",
      promptTokens: 1_000_000,
      completionTokens: 500_000,
      costUsdMicros: 999_999_999,
    });
    const d = await resolveReasoningProvider(ids.accountA.id);
    expect(d.withinBudget).toBe(true);
    expect(d.provider).toBe(FAKE_CONFIGURED);
    expect(d.capUsdMicros).toBe(Number.POSITIVE_INFINITY);
  });

  it("is tenant-scoped — account A's spend never caps account B", async () => {
    await recordReasoningUsage({
      accountId: ids.accountA.id,
      surface: "brief",
      provider: "ollama",
      model: "qwen",
      promptTokens: 1000,
      completionTokens: 200,
      costUsdMicros: FREE_CAP,
    });
    const b = await resolveReasoningProvider(ids.accountB.id);
    expect(b.withinBudget).toBe(true);
    expect(b.usedUsdMicros).toBe(0);
  });
});

describe("recordReasoningSpend", () => {
  it("records cost when meta.usage is present", async () => {
    await recordReasoningSpend({
      accountId: ids.accountA.id,
      surface: "brief",
      meta: { provider: "ollama", model: "qwen", usage: { promptTokens: 600, completionTokens: 40, costUsdMicros: 210 } },
    });
    expect(await getMonthlyReasoningCostUsdMicros(ids.accountA.id)).toBe(210);
  });

  it("writes nothing for the deterministic path (no usage)", async () => {
    await recordReasoningSpend({
      accountId: ids.accountA.id,
      surface: "brief",
      meta: { provider: "deterministic", model: "rules" },
    });
    expect(await getMonthlyReasoningCostUsdMicros(ids.accountA.id)).toBe(0);
  });
});
