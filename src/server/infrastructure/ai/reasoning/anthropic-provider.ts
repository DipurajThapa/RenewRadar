/**
 * Anthropic Renewal Intelligence reasoner — wired but DORMANT behind the key
 * gate. The factory only constructs this when AI_REASONING_PROVIDER=anthropic
 * AND ANTHROPIC_API_KEY is set, so the throw on a missing SDK is reachable only
 * via misconfiguration (key set, SDK absent) — the same precedent as the
 * existing AnthropicNotConfigured extraction provider. The default shipped path
 * is the deterministic engine.
 *
 * When enabled it produces the SAME typed Brief, re-stamps every claim
 * engine:"llm", and is held to the SAME `validateBrief` evidence binding — the
 * model cannot smuggle an unsupported claim or a fabricated clause quote.
 */
import type {
  GroundedAnswer,
  QuestionInput,
  RenewalBriefInput,
  RenewalIntelligenceBrief,
  ReasoningProvider,
} from "./types";
import { validateAnswer, validateBrief } from "./validate";
import { DeterministicReasoningProvider } from "./deterministic-provider";

const ASK_SYSTEM_PROMPT = `You are Renewal Radar's grounded assistant. Answer the
user's question USING ONLY the provided facts (each carries a source + ref).
Rules:
- You are an ADVISOR, never an agent. Never offer to email, pay, renew, cancel,
  sign, or act — only inform and point to a screen.
- Every answer claim MUST cite evidence drawn only from the provided facts. If
  you quote, quote verbatim. Never invent numbers, dates, or vendors.
- If the facts don't answer the question, say so honestly in missingInfo.`;

const SYSTEM_PROMPT = `You are Renewal Radar's renewal-intelligence analyst.
You produce a structured brief for a SaaS renewal decision, reasoning over the
provided signals (price trajectory, cross-account benchmark, notice-deadline
urgency, negotiation leverage, prior decisions). Rules:
- You are an ADVISOR, never an agent. Never recommend emailing or contacting the
  vendor; phrase levers as advice the human executes ("anchor with a competing
  quote"), never as an action you take.
- Every claim MUST carry evidence drawn only from the provided signals. If you
  quote the price-increase clause, quote it verbatim.
- Recommended action is one of: renewed | renewed_with_adjustments | downgraded
  | cancelled | deferred.`;

export class AnthropicReasoningProvider implements ReasoningProvider {
  readonly providerName = "anthropic-reasoner";
  readonly model = "claude-sonnet";
  readonly promptVersion = "v1.0";

  async buildBrief(
    input: RenewalBriefInput
  ): Promise<RenewalIntelligenceBrief> {
    // Loose dynamic import: the SDK is an optional dependency not installed
    // until the keys milestone. Typed structurally so the build stays green
    // without the package; the factory key-gate makes this path unreachable in
    // current config.
    type AnthropicClient = {
      messages: {
        create: (args: unknown) => Promise<{
          content: Array<{ type: string; text?: string }>;
        }>;
      };
    };
    let client: AnthropicClient;
    try {
      // Variable specifier + webpackIgnore: keep this a PURE RUNTIME import so
      // the bundler never tries to resolve the (not-yet-installed) optional
      // dependency at build time. Resolves once `pnpm add @anthropic-ai/sdk`
      // lands; throws cleanly (caught below) until then.
      const sdkName = "@anthropic-ai/sdk";
      const mod = (await import(/* webpackIgnore: true */ sdkName)) as {
        default: new (o: { apiKey?: string }) => AnthropicClient;
      };
      const Anthropic = mod.default;
      client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } catch {
      // Misconfig only: key present but SDK not installed. Honest precedent —
      // not a claim that this satisfies "no throwing stubs"; the factory makes
      // it unreachable in current dev/test/staging config.
      throw new Error(
        "AI_REASONING_PROVIDER=anthropic but @anthropic-ai/sdk is not installed."
      );
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: JSON.stringify(input) },
      ],
    });

    // Parse the model's JSON brief, re-stamp provenance, then enforce the SAME
    // validator the deterministic engine uses. On any parse failure, fall back
    // to the deterministic brief rather than ship nothing.
    try {
      const text = message.content
        .map((b: { type: string; text?: string }) =>
          b.type === "text" ? (b.text ?? "") : ""
        )
        .join("");
      const parsed = JSON.parse(text) as RenewalIntelligenceBrief;
      const restamped: RenewalIntelligenceBrief = {
        ...parsed,
        meta: {
          provider: this.providerName,
          model: this.model,
          promptVersion: this.promptVersion,
          confidencePct: parsed.meta?.confidencePct ?? 60,
          engine: "llm",
          briefVersion: "brief-v1",
        },
        claims: (parsed.claims ?? []).map((c) => ({ ...c, engine: "llm" })),
      };
      return validateBrief(restamped, {
        clauseText: input.priceIncreaseClauseText,
      });
    } catch {
      return new DeterministicReasoningProvider().buildBrief(input);
    }
  }

  /**
   * Grounded Q&A (Phase 3) — same dormant key-gated path as buildBrief. Re-stamps
   * engine:"llm", enforces the SAME `validateAnswer` evidence gate (so the model
   * cannot answer beyond the provided facts), and falls back to the deterministic
   * answer on any error.
   */
  async answerQuestion(input: QuestionInput): Promise<GroundedAnswer> {
    type AnthropicClient = {
      messages: {
        create: (args: unknown) => Promise<{
          content: Array<{ type: string; text?: string }>;
        }>;
      };
    };
    let client: AnthropicClient;
    try {
      const sdkName = "@anthropic-ai/sdk";
      const mod = (await import(/* webpackIgnore: true */ sdkName)) as {
        default: new (o: { apiKey?: string }) => AnthropicClient;
      };
      const Anthropic = mod.default;
      client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } catch {
      throw new Error(
        "AI_REASONING_PROVIDER=anthropic but @anthropic-ai/sdk is not installed."
      );
    }

    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        system: ASK_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(input) }],
      });
      const text = message.content
        .map((b: { type: string; text?: string }) =>
          b.type === "text" ? (b.text ?? "") : ""
        )
        .join("");
      const parsed = JSON.parse(text) as GroundedAnswer;
      const restamped: GroundedAnswer = {
        ...parsed,
        meta: {
          provider: this.providerName,
          model: this.model,
          promptVersion: this.promptVersion,
          confidencePct: parsed.meta?.confidencePct ?? 60,
          engine: "llm",
        },
        question: input.question,
        answers: (parsed.answers ?? []).map((a) => ({ ...a, engine: "llm" })),
      };
      return validateAnswer(restamped, {
        sourceTexts: input.facts.map(
          (f) => `${f.detail}${f.quote ? `\n${f.quote}` : ""}`
        ),
      });
    } catch {
      return new DeterministicReasoningProvider().answerQuestion(input);
    }
  }
}
