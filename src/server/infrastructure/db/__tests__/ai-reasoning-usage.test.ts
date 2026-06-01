/**
 * AI reasoning-usage ledger (F3) — the monthly spend the per-account cap is
 * checked against. Asserts the monthly window, tenant isolation, and the rollup.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  getMonthlyReasoningCostUsdMicros,
  getMonthlyReasoningUsage,
  recordReasoningUsage,
} from "@server/infrastructure/db/repositories/ai-reasoning-usage";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

describe("recordReasoningUsage + getMonthlyReasoningCostUsdMicros", () => {
  it("sums this account's cost for the current month", async () => {
    const a = ids.accountA.id;
    await recordReasoningUsage({ accountId: a, surface: "brief", provider: "ollama", model: "qwen", promptTokens: 600, completionTokens: 40, costUsdMicros: 210 });
    await recordReasoningUsage({ accountId: a, surface: "ask", provider: "ollama", model: "qwen", promptTokens: 200, completionTokens: 20, costUsdMicros: 90 });
    expect(await getMonthlyReasoningCostUsdMicros(a)).toBe(300);
  });

  it("is tenant-scoped — account B sees nothing from account A", async () => {
    await recordReasoningUsage({ accountId: ids.accountA.id, surface: "brief", provider: "ollama", model: "qwen", promptTokens: 600, completionTokens: 40, costUsdMicros: 500 });
    expect(await getMonthlyReasoningCostUsdMicros(ids.accountB.id)).toBe(0);
  });

  it("excludes rows outside the queried calendar month", async () => {
    const a = ids.accountA.id;
    await recordReasoningUsage({ accountId: a, surface: "brief", provider: "ollama", model: "qwen", promptTokens: 600, completionTokens: 40, costUsdMicros: 210 });
    // Query as if it were next month → the just-inserted rows are before that
    // month's start, so the window must exclude them.
    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
    nextMonth.setUTCHours(12, 0, 0, 0);
    expect(await getMonthlyReasoningCostUsdMicros(a, nextMonth)).toBe(0);
  });

  it("clamps negative inputs to zero (no negative billing)", async () => {
    const a = ids.accountA.id;
    await recordReasoningUsage({ accountId: a, surface: "brief", provider: "ollama", model: "qwen", promptTokens: -5, completionTokens: -1, costUsdMicros: -100 });
    expect(await getMonthlyReasoningCostUsdMicros(a)).toBe(0);
  });
});

describe("getMonthlyReasoningUsage (telemetry rollup)", () => {
  it("rolls up calls + tokens + cost", async () => {
    const a = ids.accountA.id;
    await recordReasoningUsage({ accountId: a, surface: "brief", provider: "ollama", model: "qwen", promptTokens: 600, completionTokens: 40, costUsdMicros: 210 });
    await recordReasoningUsage({ accountId: a, surface: "ask", provider: "ollama", model: "qwen", promptTokens: 200, completionTokens: 20, costUsdMicros: 90 });
    const u = await getMonthlyReasoningUsage(a);
    expect(u.calls).toBe(2);
    expect(u.promptTokens).toBe(800);
    expect(u.completionTokens).toBe(60);
    expect(u.costUsdMicros).toBe(300);
  });
});
