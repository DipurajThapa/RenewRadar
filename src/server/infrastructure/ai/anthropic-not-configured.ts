/**
 * Anthropic Claude Sonnet 4.6 provider — production scaffold.
 *
 * Covers both the structured extraction interface AND the insight interface
 * (risk explainer, vendor intelligence summary, decision recommendation,
 * savings narrative).
 *
 * The real implementation:
 *   1. pnpm add @anthropic-ai/sdk
 *   2. Construct an Anthropic client with ANTHROPIC_API_KEY
 *   3. Send a single structured-extraction message with the system prompt
 *      below and a JSON schema constraint via tool-use
 *   4. Validate the response against the same ExtractedFieldDraft shape
 *      this interface returns
 *   5. Set costUsdMicros from usage * model price
 *
 * The system prompts — pinned at promptVersion v1.0 — and the JSON schemas
 * are both kept here so prompt changes are reviewable in PR. When the SDK
 * lands, copy these strings into the real provider unchanged.
 *
 * Until then this stub throws on any call. The factory in `index.ts` only
 * instantiates it when AI_EXTRACTION_PROVIDER=anthropic AND ANTHROPIC_API_KEY
 * is set; otherwise the factory silently falls back to the heuristic stub.
 */
import type {
  AIInsightProvider,
  DecisionRecommendationInput,
  DecisionRecommendationOutput,
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
  RiskExplainerInput,
  RiskExplainerOutput,
  SavingsNarrativeInput,
  SavingsNarrativeOutput,
  VendorIntelligenceInput,
  VendorIntelligenceOutput,
} from "./types";

/**
 * Pinned system prompt for extraction. Versioned. When you change it, bump
 * PROMPT_VERSION so historical runs can be reproduced or re-evaluated.
 */
export const ANTHROPIC_SYSTEM_PROMPT = `You are extracting six structured fields from a SaaS contract.

For each field you find, return:
  - fieldKey: one of [renewal_date, notice_period_days, auto_renewal,
              contract_value_cents, price_increase_clause, cancellation_method]
  - rawValue: the exact substring you matched
  - parsedValueJson: the typed value (date in YYYY-MM-DD, days as integer,
                     yes as boolean, cents + currency, clause as string,
                     method as enum)
  - confidencePct: integer 0-100
  - evidenceQuote: a verbatim sentence from the contract that supports the value
  - evidencePageNumber: 1-indexed page number, or null if unknown

Rules:
  1. NEVER invent evidence. If a field is not clearly present, omit it.
  2. The evidenceQuote MUST be verbatim from the contract — no paraphrasing.
  3. If two interpretations are possible, return the most conservative one.
  4. If the contract says it does NOT auto-renew, return auto_renewal with
     {yes: false} and confidence ≥85 — that's a critical signal for the user.

Return JSON only. No prose.`;

/**
 * Pinned system prompt for the insight methods. Lower temperature, shorter
 * output, no extraction-style evidence requirement.
 */
export const ANTHROPIC_INSIGHTS_SYSTEM_PROMPT = `You are explaining renewal-intelligence signals to a SaaS finance operator.

Style:
  - One headline (≤120 chars). Two- to three-sentence rationale. 1-3 next actions.
  - Plain prose. No hedging. No "as an AI" boilerplate.
  - Money formatted as $XK / $X.XM. No currency symbol other than $.
  - Never invent facts. Synthesize ONLY from the structured input.

You never recommend sending an email to a vendor on behalf of the user. Renewal
Radar is an advisor product, not an agent.

Return JSON only. No prose outside the JSON.`;

export const PROMPT_VERSION = "v1.0";
export const MODEL = "claude-sonnet-4-6";
const PROVIDER_NAME = "anthropic";

const NOT_CONFIGURED_MESSAGE =
  "Anthropic provider is not configured. To enable:\n" +
  "  1. pnpm add @anthropic-ai/sdk\n" +
  "  2. Set ANTHROPIC_API_KEY in your env\n" +
  "  3. Replace this class with a real Anthropic call using\n" +
  `     ANTHROPIC_SYSTEM_PROMPT (PROMPT_VERSION=${PROMPT_VERSION}, MODEL=${MODEL}).\n` +
  "Until then, leave AI_EXTRACTION_PROVIDER unset (defaults to heuristic-stub).";

export class AnthropicNotConfiguredProvider
  implements ExtractionProvider, AIInsightProvider
{
  readonly providerName = PROVIDER_NAME;
  readonly model = MODEL;
  readonly promptVersion = PROMPT_VERSION;

  async extract(_input: ExtractionInput): Promise<ExtractionResult> {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }

  async explainRisk(_input: RiskExplainerInput): Promise<RiskExplainerOutput> {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }

  async summarizeVendorIntelligence(
    _input: VendorIntelligenceInput
  ): Promise<VendorIntelligenceOutput> {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }

  async recommendRenewalDecision(
    _input: DecisionRecommendationInput
  ): Promise<DecisionRecommendationOutput> {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }

  async narrateSavings(
    _input: SavingsNarrativeInput
  ): Promise<SavingsNarrativeOutput> {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
}
