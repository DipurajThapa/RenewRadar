/**
 * AI reasoning-usage ledger (Phase 6, F3). One row per metered LLM reasoning op
 * (brief / Ask). The reasoning analog of `getMonthlyPagesUsed` for extraction:
 * the monthly cost sum here is what the per-account spend cap is checked against.
 *
 * Local inference is free, but each row carries the hosted-equivalent cost so the
 * cap is meaningful the moment serving moves to a hosted/served model.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { aiReasoningUsageTable } from "@server/infrastructure/db/schema";
import type { AiReasoningSurface } from "@server/infrastructure/db/schema";

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = DrizzleTx | typeof db;

export type RecordReasoningUsageInput = {
  accountId: string;
  surface: AiReasoningSurface;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsdMicros: number;
};

/** Append one usage row. Non-negative integers enforced (no negative billing). */
export async function recordReasoningUsage(
  input: RecordReasoningUsageInput,
  tx: DbOrTx = db
): Promise<void> {
  await tx.insert(aiReasoningUsageTable).values({
    accountId: input.accountId,
    surface: input.surface,
    provider: input.provider,
    model: input.model,
    promptTokens: nonNeg(input.promptTokens),
    completionTokens: nonNeg(input.completionTokens),
    costUsdMicros: nonNeg(input.costUsdMicros),
  });
}

/** UTC start of the current calendar month — the cap window. */
function monthStartUtc(now: Date): Date {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function nonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Sum of hosted-equivalent cost (micro-USD) for THIS account this month. */
export async function getMonthlyReasoningCostUsdMicros(
  accountId: string,
  now: Date = new Date()
): Promise<number> {
  const [row] = await db
    .select({
      cost: sql<string>`coalesce(sum(${aiReasoningUsageTable.costUsdMicros}), 0)::bigint`,
    })
    .from(aiReasoningUsageTable)
    .where(
      and(
        eq(aiReasoningUsageTable.accountId, accountId),
        gte(aiReasoningUsageTable.createdAt, monthStartUtc(now))
      )
    );
  return Number(row?.cost ?? 0);
}

export type MonthlyReasoningUsage = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsdMicros: number;
};

/** Full monthly rollup for telemetry (the /admin system-health surface). */
export async function getMonthlyReasoningUsage(
  accountId: string,
  now: Date = new Date()
): Promise<MonthlyReasoningUsage> {
  const [row] = await db
    .select({
      calls: sql<string>`count(*)::bigint`,
      promptTokens: sql<string>`coalesce(sum(${aiReasoningUsageTable.promptTokens}), 0)::bigint`,
      completionTokens: sql<string>`coalesce(sum(${aiReasoningUsageTable.completionTokens}), 0)::bigint`,
      costUsdMicros: sql<string>`coalesce(sum(${aiReasoningUsageTable.costUsdMicros}), 0)::bigint`,
    })
    .from(aiReasoningUsageTable)
    .where(
      and(
        eq(aiReasoningUsageTable.accountId, accountId),
        gte(aiReasoningUsageTable.createdAt, monthStartUtc(now))
      )
    );
  return {
    calls: Number(row?.calls ?? 0),
    promptTokens: Number(row?.promptTokens ?? 0),
    completionTokens: Number(row?.completionTokens ?? 0),
    costUsdMicros: Number(row?.costUsdMicros ?? 0),
  };
}
