/**
 * Local-LLM Renewal Intelligence reasoner — the genuinely-AI path, served by a
 * local Ollama model (default qwen3.6). This is the "AI-first" engine: the model
 * does the REASONING (the narrative claims + recommendation), held to the SAME
 * evidence-binding validator as every other engine.
 *
 * Trust design (no-hallucination, advisor-not-agent):
 *   1. Every claim is re-stamped engine:"llm" and run through `validateBrief` /
 *      `validateAnswer` — claims with no evidence, or a clause quote that isn't a
 *      verbatim substring of the real clause, are DROPPED.
 *   2. Hard numbers stay deterministic: the predicted next-year figure and the
 *      Ask deep-links are taken from the DeterministicReasoningProvider, never
 *      from the model — so the model cannot invent a dollar amount or a URL.
 *   3. Graceful degradation: any failure (server down, timeout, bad JSON, or all
 *      claims stripped by the validator) returns the proven deterministic output.
 *      The app never hangs and never ships an empty or ungrounded brief.
 *
 * Because of (3) this provider is ALWAYS safe to construct — there is no key to
 * gate. When the model is unreachable it simply behaves as the deterministic
 * engine (honestly stamped engine:"deterministic").
 */
import type {
  AnswerClaim,
  BriefClaim,
  BriefClaimKey,
  BriefEvidence,
  GroundedAnswer,
  QuestionInput,
  RecommendedAction,
  RenewalBriefInput,
  RenewalIntelligenceBrief,
  ReasoningProvider,
  RetrievedFact,
} from "./types";
import { validateAnswer, validateBrief } from "./validate";
import { DeterministicReasoningProvider } from "./deterministic-provider";
import { LocalLlmClient } from "../local-llm/client";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "ai.reasoning.ollama" });

const EVIDENCE_SOURCES: BriefEvidence["source"][] = [
  "charge_history",
  "benchmark",
  "notice_deadline",
  "auto_renew_flag",
  "price_increase_clause",
  "prior_decision",
];

const CLAIM_KEYS: BriefClaimKey[] = [
  "price_trajectory",
  "benchmark_position",
  "renewal_risk",
  "leverage",
  "batna",
  "recommended_action",
];

const ACTIONS: RecommendedAction[] = [
  "renewed",
  "renewed_with_adjustments",
  "downgraded",
  "cancelled",
  "deferred",
];

const BRIEF_SYSTEM_PROMPT = `You are Renewal Radar's renewal-intelligence analyst.
You receive a JSON object of SIGNALS about ONE SaaS subscription and must return
a single JSON BRIEF reasoning over those signals.

HARD RULES
- You are an ADVISOR, never an agent. Never suggest emailing, contacting, paying,
  renewing, cancelling, or signing on the user's behalf. Phrase negotiation
  levers as advice the human executes ("anchor with a competing quote").
- If the signals say the notice deadline is already MISSED
  (noticeDeadlineMissed=true), recommendedAction MUST be "deferred": the
  cancellation window is gone, so advise regrouping rather than a fresh renewal.
- Ground EVERY claim ONLY in the provided signals. Never invent vendors, dates,
  or numbers.
- Attach a non-null "quote" ONLY when citing the price-increase clause, and it
  MUST be copied character-for-character from input.priceIncreaseClauseText.
  Otherwise set "quote": null. A fabricated quote discards the whole claim.
- Do NOT output prediction figures: set "predictedNextAnnualCents": null. The
  system computes that number deterministically.

OUTPUT — return ONLY this JSON object, no prose:
{
  "recommendedAction": "renewed" | "renewed_with_adjustments" | "downgraded" | "cancelled" | "deferred",
  "claims": [
    {
      "key": "price_trajectory" | "benchmark_position" | "renewal_risk" | "leverage" | "batna" | "recommended_action",
      "statement": "<one concise sentence>",
      "confidencePct": <integer 0-100>,
      "evidence": [
        {
          "source": "charge_history" | "benchmark" | "notice_deadline" | "auto_renew_flag" | "price_increase_clause" | "prior_decision",
          "detail": "<short fact drawn from the signals>",
          "quote": <verbatim clause substring or null>,
          "refId": <string or null>
        }
      ]
    }
  ],
  "predictedNextAnnualCents": null
}
Emit 2-5 claims. Every claim needs >=1 evidence item. Always include one claim
with key "recommended_action" that justifies your recommendedAction.`;

const ASK_SYSTEM_PROMPT = `You are Renewal Radar's grounded assistant. You receive
a QUESTION and a list of FACTS retrieved from the user's own account. Answer ONLY
from those facts.

HARD RULES
- You are an ADVISOR, never an agent. Never offer to email, pay, renew, cancel,
  sign, or act — only inform.
- Every answer claim's evidence MUST be chosen from the provided facts: copy a
  fact's "detail" verbatim into evidence.detail. Set a non-null "quote" only if
  that exact text appears in a fact's "quote". Never invent numbers/dates/vendors.
- If the facts don't answer the question, say so in "missingInfo" and return few
  or no answers.

OUTPUT — return ONLY this JSON object, no prose:
{
  "summary": "<= 200 chars",
  "answers": [
    {
      "statement": "<one concise sentence>",
      "confidencePct": <integer 0-100>,
      "evidence": [
        { "source": "<fact.source>", "detail": "<verbatim fact.detail>", "quote": null, "refId": null, "href": null }
      ]
    }
  ],
  "missingInfo": ["<what the facts don't cover>"],
  "deepLinks": []
}
"deepLinks" is added by the system — leave it []. Every answer needs >=1 evidence.`;

type RawBrief = {
  recommendedAction?: string;
  claims?: Array<{
    key?: string;
    statement?: unknown;
    confidencePct?: unknown;
    evidence?: Array<{
      source?: string;
      detail?: unknown;
      quote?: unknown;
      refId?: unknown;
    }>;
  }>;
};

type RawAnswer = {
  summary?: unknown;
  answers?: Array<{
    statement?: unknown;
    confidencePct?: unknown;
    evidence?: Array<{
      source?: unknown;
      detail?: unknown;
      quote?: unknown;
      refId?: unknown;
      href?: unknown;
    }>;
  }>;
  missingInfo?: unknown;
};

function coerceSource(s: unknown): BriefEvidence["source"] {
  return EVIDENCE_SOURCES.includes(s as BriefEvidence["source"])
    ? (s as BriefEvidence["source"])
    : "charge_history";
}

function coerceKey(k: unknown): BriefClaimKey {
  return CLAIM_KEYS.includes(k as BriefClaimKey)
    ? (k as BriefClaimKey)
    : "recommended_action";
}

function coerceAction(a: unknown): RecommendedAction | null {
  return ACTIONS.includes(a as RecommendedAction)
    ? (a as RecommendedAction)
    : null;
}

function toInt0to100(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function metaConfidence(claims: BriefClaim[]): number {
  if (claims.length === 0) return 60;
  const rec = claims.find((c) => c.key === "recommended_action");
  const v = rec?.confidencePct ?? Math.max(...claims.map((c) => c.confidencePct));
  return Math.max(0, Math.min(100, Math.round(v)));
}

export class OllamaReasoningProvider implements ReasoningProvider {
  readonly providerName = "ollama-reasoner";
  readonly model: string;
  readonly promptVersion = "local-v1";
  private readonly client: Pick<LocalLlmClient, "chatJson" | "model">;
  private readonly deterministic = new DeterministicReasoningProvider();

  constructor(client?: Pick<LocalLlmClient, "chatJson" | "model">) {
    this.client = client ?? new LocalLlmClient();
    this.model = this.client.model;
  }

  async buildBrief(
    input: RenewalBriefInput
  ): Promise<RenewalIntelligenceBrief> {
    // Always compute the deterministic brief first: it's pure, fast, and never
    // fails — it is both our numeric source of truth and our fallback.
    const fallback = await this.deterministic.buildBrief(input);

    try {
      const raw = await this.client.chatJson<RawBrief>({
        system: BRIEF_SYSTEM_PROMPT,
        user: JSON.stringify(input),
      });

      const claims: BriefClaim[] = (raw.claims ?? [])
        .filter(
          (c) =>
            c &&
            typeof c.statement === "string" &&
            Array.isArray(c.evidence) &&
            c.evidence.length > 0
        )
        .map((c) => ({
          key: coerceKey(c.key),
          statement: String(c.statement),
          engine: "llm" as const,
          confidencePct: toInt0to100(c.confidencePct, 60),
          evidence: (c.evidence ?? []).map((ev) => ({
            source: coerceSource(ev.source),
            detail: typeof ev.detail === "string" ? ev.detail : "",
            quote: strOrNull(ev.quote),
            refId: strOrNull(ev.refId),
          })),
        }));

      const candidate: RenewalIntelligenceBrief = {
        meta: {
          provider: this.providerName,
          model: this.model,
          promptVersion: this.promptVersion,
          confidencePct: metaConfidence(claims),
          engine: "llm",
          briefVersion: "brief-v1",
        },
        headline: "",
        // A missed notice deadline is a hard FACT, not a judgment call — enforce
        // "deferred" deterministically so the model can't contradict it. This
        // also matches the deterministic engine's invariant.
        recommendedAction: input.noticeDeadlineMissed
          ? "deferred"
          : coerceAction(raw.recommendedAction) ?? fallback.recommendedAction,
        claims,
        // Numbers stay deterministic — the model never invents a dollar figure.
        predictedNextAnnualCents: fallback.predictedNextAnnualCents,
      };

      const validated = validateBrief(candidate, {
        clauseText: input.priceIncreaseClauseText,
      });

      // If the validator stripped every claim, the LLM contributed nothing
      // grounded — return the proven deterministic brief rather than an empty one.
      if (validated.claims.length === 0) {
        log.warn("brief_no_grounded_claims_fell_back", {
          subscriptionId: input.subscriptionId,
          model: this.model,
        });
        return fallback;
      }

      return validated;
    } catch (err) {
      log.warn("brief_llm_failed_fell_back", {
        subscriptionId: input.subscriptionId,
        model: this.model,
        error: (err as Error)?.message ?? String(err),
      });
      return fallback;
    }
  }

  async answerQuestion(input: QuestionInput): Promise<GroundedAnswer> {
    const fallback = await this.deterministic.answerQuestion(input);

    // No facts → nothing to ground in. Any model answer would be ungrounded by
    // definition (and validateAnswer can't catch a quote-less fabrication), so
    // we return the honest deterministic "no data" answer without calling the
    // model. This is the advisor-not-agent / no-hallucination floor.
    if (input.facts.length === 0) return fallback;

    try {
      const raw = await this.client.chatJson<RawAnswer>({
        system: ASK_SYSTEM_PROMPT,
        user: JSON.stringify(input),
      });

      const answers: AnswerClaim[] = (raw.answers ?? [])
        .filter(
          (a) =>
            a &&
            typeof a.statement === "string" &&
            Array.isArray(a.evidence) &&
            a.evidence.length > 0
        )
        .map((a) => ({
          statement: String(a.statement),
          engine: "llm" as const,
          confidencePct: toInt0to100(a.confidencePct, 60),
          evidence: (a.evidence ?? []).map(
            (ev): RetrievedFact => ({
              source: typeof ev.source === "string" ? ev.source : "fact",
              detail: typeof ev.detail === "string" ? ev.detail : "",
              quote: strOrNull(ev.quote),
              refId: strOrNull(ev.refId),
              href: strOrNull(ev.href),
            })
          ),
        }));

      const candidate: GroundedAnswer = {
        meta: {
          provider: this.providerName,
          model: this.model,
          promptVersion: this.promptVersion,
          confidencePct: answers.length
            ? Math.max(...answers.map((a) => a.confidencePct))
            : 60,
          engine: "llm",
        },
        question: input.question,
        summary:
          typeof raw.summary === "string"
            ? raw.summary.slice(0, 200)
            : fallback.summary,
        answers,
        missingInfo: Array.isArray(raw.missingInfo)
          ? raw.missingInfo.map((m) => String(m)).filter((m) => m.length > 0)
          : [],
        // Deep-links stay deterministic — the model never invents a URL.
        deepLinks: fallback.deepLinks,
      };

      const validated = validateAnswer(candidate, {
        sourceTexts: input.facts.map(
          (f) => `${f.detail}${f.quote ? `\n${f.quote}` : ""}`
        ),
      });

      // Had real facts but the LLM produced nothing grounded → prefer the
      // deterministic answer (which is built directly from those facts).
      if (validated.answers.length === 0 && input.facts.length > 0) {
        log.warn("answer_no_grounded_claims_fell_back", { model: this.model });
        return fallback;
      }

      return validated;
    } catch (err) {
      log.warn("answer_llm_failed_fell_back", {
        model: this.model,
        error: (err as Error)?.message ?? String(err),
      });
      return fallback;
    }
  }
}
