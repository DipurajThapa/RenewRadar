/**
 * Per-account AI reasoning budget (Phase 6, F3) — the enforcement that makes the
 * spend cap real. Mirrors the AI-pages cap, adapted for token spend (priced only
 * AFTER a call): we PRE-CHECK the month's spend at the reasoning entry point and,
 * if the account is over its tier cap, serve the deterministic engine (free,
 * grounded — degrade, never overbill). After an allowed LLM call we RECORD the
 * actual cost to the ledger. Soft cap: worst-case overshoot is one in-flight call.
 */
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable } from "@server/infrastructure/db/schema";
import type { AiReasoningSurface } from "@server/infrastructure/db/schema";
import type { InsightMeta } from "@server/infrastructure/ai/types";
import { TIER_DEFINITIONS, type PlanTier } from "@server/domain/billing/tier-definitions";
import { checkBudget } from "@server/infrastructure/ai/local-llm/usage";
import {
  getFallbackReasoningProvider,
  getReasoningProvider,
} from "@server/infrastructure/ai";
import type { ReasoningProvider } from "@server/infrastructure/ai/reasoning/types";
import {
  getMonthlyReasoningCostUsdMicros,
  recordReasoningUsage,
} from "@server/infrastructure/db/repositories/ai-reasoning-usage";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "ai-budget" });

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = DrizzleTx | typeof db;

export type ReasoningBudgetDecision = {
  /** Configured provider when within budget; deterministic fallback when over. */
  provider: ReasoningProvider;
  /** false = forced deterministic because the account is over its monthly cap. */
  withinBudget: boolean;
  usedUsdMicros: number;
  capUsdMicros: number;
};

async function planTierFor(accountId: string): Promise<PlanTier> {
  const [row] = await db
    .select({ planTier: accountsTable.planTier })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  return (row?.planTier as PlanTier) ?? "free_forever";
}

/**
 * Choose the reasoning provider for THIS account: the configured engine when the
 * month's spend is under the tier cap, otherwise the deterministic fallback.
 * `InsightMeta.usage` (Infinity cap = enterprise → always within budget).
 */
export async function resolveReasoningProvider(
  accountId: string,
  now: Date = new Date()
): Promise<ReasoningBudgetDecision> {
  const planTier = await planTierFor(accountId);
  const capUsdMicros =
    TIER_DEFINITIONS[planTier].limits.aiReasoningUsdMicrosPerMonth;
  const usedUsdMicros = await getMonthlyReasoningCostUsdMicros(accountId, now);
  const check = checkBudget(usedUsdMicros, capUsdMicros);

  if (!check.allowed) {
    log.warn("reasoning_budget_exceeded_serving_deterministic", {
      accountId,
      planTier,
      usedUsdMicros,
      capUsdMicros,
    });
  }
  return {
    provider: check.allowed
      ? getReasoningProvider()
      : getFallbackReasoningProvider(),
    withinBudget: check.allowed,
    usedUsdMicros,
    capUsdMicros,
  };
}

/**
 * Record what an allowed LLM call actually cost. No-op when `meta.usage` is
 * absent (deterministic path / a call that never completed) — so the over-budget
 * degraded path and the offline-fallback path write nothing.
 */
export async function recordReasoningSpend(
  args: {
    accountId: string;
    surface: AiReasoningSurface;
    meta: Pick<InsightMeta, "provider" | "model" | "usage">;
  },
  tx: DbOrTx = db
): Promise<void> {
  const usage = args.meta.usage;
  if (!usage) return;
  await recordReasoningUsage(
    {
      accountId: args.accountId,
      surface: args.surface,
      provider: args.meta.provider,
      model: args.meta.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsdMicros: usage.costUsdMicros,
    },
    tx
  );
}
