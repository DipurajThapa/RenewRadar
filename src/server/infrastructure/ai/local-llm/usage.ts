/**
 * AI unit economics (Phase 6, F1/F3) — token accounting, a cost model, a process
 * usage meter, and a per-account budget guard. Local inference is ~free, but a
 * production served/hosted model is priced per token; this measures it so the
 * cost is a number, not a guess.
 *
 * Costs are in micro-USD (1e-6 dollars) — integers, no float drift.
 */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Ollama /api/chat reports prompt_eval_count + eval_count. */
export function usageFromOllama(envelope: unknown): TokenUsage {
  const e = (envelope ?? {}) as Record<string, unknown>;
  const promptTokens = num(e.prompt_eval_count);
  const completionTokens = num(e.eval_count);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

/** OpenAI /v1/chat/completions reports usage.{prompt,completion,total}_tokens. */
export function usageFromOpenAi(envelope: unknown): TokenUsage {
  const u = ((envelope ?? {}) as { usage?: Record<string, unknown> }).usage ?? {};
  const promptTokens = num(u.prompt_tokens);
  const completionTokens = num(u.completion_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: num(u.total_tokens) || promptTokens + completionTokens,
  };
}

export type Pricing = {
  /** micro-USD per 1,000 prompt tokens. */
  inputPer1kUsdMicros: number;
  /** micro-USD per 1,000 completion tokens. */
  outputPer1kUsdMicros: number;
};

/** Dollars-per-1k string → micro-USD per 1k. Default 0 (local model is free). */
function dollarsPer1kToMicros(v: string | undefined): number {
  if (v == null || v.trim() === "") return 0;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : 0;
}

export function resolvePricing(env: NodeJS.ProcessEnv = process.env): Pricing {
  return {
    inputPer1kUsdMicros: dollarsPer1kToMicros(env.LLM_PRICE_INPUT_PER_1K),
    outputPer1kUsdMicros: dollarsPer1kToMicros(env.LLM_PRICE_OUTPUT_PER_1K),
  };
}

/**
 * Illustrative hosted-equivalent pricing for the cost reports (COST_*_PER_1K,
 * $/1k tokens). Defaults model a cheap hosted open-weight tier ($0.15/1M input,
 * $0.20/1M output) so projections are non-zero even though local inference is
 * free — the point is to price what serving WOULD cost. Override via env.
 */
export function referencePricing(env: NodeJS.ProcessEnv = process.env): Pricing {
  return {
    inputPer1kUsdMicros: dollarsPer1kToMicros(env.COST_INPUT_PER_1K ?? "0.00015"),
    outputPer1kUsdMicros: dollarsPer1kToMicros(env.COST_OUTPUT_PER_1K ?? "0.0002"),
  };
}

/** Format micro-USD as a human dollar string (6dp — per-op costs are tiny). */
export function formatUsd(micros: number, dp = 6): string {
  if (!Number.isFinite(micros)) return "∞";
  return `$${(micros / 1_000_000).toFixed(dp)}`;
}

export function estimateCostUsdMicros(usage: TokenUsage, pricing: Pricing): number {
  return Math.round(
    (usage.promptTokens / 1000) * pricing.inputPer1kUsdMicros +
      (usage.completionTokens / 1000) * pricing.outputPer1kUsdMicros
  );
}

/** Process-wide usage accumulator for observability + the cost report. */
export class UsageMeter {
  calls = 0;
  promptTokens = 0;
  completionTokens = 0;
  costUsdMicros = 0;

  record(usage: TokenUsage, costUsdMicros: number): void {
    this.calls++;
    this.promptTokens += usage.promptTokens;
    this.completionTokens += usage.completionTokens;
    this.costUsdMicros += costUsdMicros;
  }

  stats() {
    return {
      calls: this.calls,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
      costUsdMicros: this.costUsdMicros,
      avgCostUsdMicros: this.calls ? Math.round(this.costUsdMicros / this.calls) : 0,
      avgTokens: this.calls ? Math.round((this.promptTokens + this.completionTokens) / this.calls) : 0,
    };
  }

  reset(): void {
    this.calls = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.costUsdMicros = 0;
  }
}

export const sharedMeter = new UsageMeter();

// ─── F3 — per-account budget guard ───────────────────────────────────────────

export type BudgetCheck = {
  allowed: boolean;
  usedUsdMicros: number;
  capUsdMicros: number;
  remainingUsdMicros: number;
};

/**
 * Mirrors the existing AI-pages cap, but for spend: an account over its monthly
 * AI budget is denied (the caller then serves the deterministic engine — degrade,
 * never bill past the cap). A cap of 0 means unlimited.
 */
export function checkBudget(usedUsdMicros: number, capUsdMicros: number): BudgetCheck {
  if (capUsdMicros <= 0) {
    return { allowed: true, usedUsdMicros, capUsdMicros, remainingUsdMicros: Infinity };
  }
  return {
    allowed: usedUsdMicros < capUsdMicros,
    usedUsdMicros,
    capUsdMicros,
    remainingUsdMicros: Math.max(0, capUsdMicros - usedUsdMicros),
  };
}
