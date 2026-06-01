/**
 * Grounded Ask assistant composer. The reasoning pipeline is advisor-only:
 *   classify → retrieve (deterministic dispatch, or a configured vector
 *   provider) → reason (answerQuestion, which applies `validateAnswer`
 *   internally) → return. It never crosses the autonomy boundary — it only
 *   answers from the account's own data and takes no external action.
 *
 * The ONE write it makes is internal metering: the token cost of an allowed LLM
 * call is recorded to the per-account reasoning ledger (F3), exactly like the
 * AI-pages cap meters extraction. Over budget, the deterministic engine answers
 * for free and nothing is recorded.
 */
import { getIntentRouter } from "@server/infrastructure/ai/intent/router";
import type {
  GroundedAnswer,
  RetrievedFact,
} from "@server/infrastructure/ai/reasoning/types";
import { getRetriever } from "@server/infrastructure/retriever";
import {
  recordReasoningSpend,
  resolveReasoningProvider,
} from "@server/application/ai-budget";
import { retrieveFacts } from "./retrieve";
import { semanticRetrievalEnabled, semanticRetrieveFacts } from "./semantic-retrieve";

/** Classify + retrieve the grounded fact pool (shared by the sync + stream paths). */
async function retrieveForQuestion(
  accountId: string,
  question: string
): Promise<RetrievedFact[]> {
  const intent = await getIntentRouter().classify(question);
  // Retrieval priority:
  //   1. a configured EXTERNAL vector store (RETRIEVER_PROVIDER), if any;
  //   2. the in-app SEMANTIC retriever (default ON) — embeds + ranks a broad pool
  //      of the account's real facts, handling paraphrased / off-menu questions;
  //   3. the deterministic single-intent SQL dispatch (always-correct fallback).
  const vector = getRetriever();
  return vector
    ? vector.retrieve({ accountId, question, intent })
    : semanticRetrievalEnabled()
      ? semanticRetrieveFacts(accountId, question, intent)
      : retrieveFacts(accountId, intent, question);
}

async function reasonAndMeter(
  accountId: string,
  question: string,
  facts: RetrievedFact[]
): Promise<GroundedAnswer> {
  // Pick the provider under the account's monthly reasoning budget (F3): within
  // budget → configured engine; over budget → deterministic (free).
  const budget = await resolveReasoningProvider(accountId);
  const answer = await budget.provider.answerQuestion({ question, facts });
  // Charge the actual token cost (no-op for the deterministic/offline path).
  await recordReasoningSpend({ accountId, surface: "ask", meta: answer.meta });
  return answer;
}

export async function answerAccountQuestion(
  accountId: string,
  question: string
): Promise<GroundedAnswer> {
  const facts = await retrieveForQuestion(accountId, question);
  return reasonAndMeter(accountId, question, facts);
}

export type AskStreamChunk =
  | { type: "preamble"; text: string; factCount: number }
  | { type: "answer"; answer: GroundedAnswer };

/**
 * Streaming Ask (Phase B/B5) — first-token latency is what users feel. We CANNOT
 * stream raw model tokens (they'd bypass `validateAnswer`'s no-hallucination
 * gate), so instead we stream a SAFE, INSTANT, deterministic preamble — composed
 * from the already-retrieved grounded facts, no model call — as the first chunk,
 * then the fully-validated answer as the second. First-token is bounded by
 * retrieval (DB + local embed), never by the multi-second model call, and nothing
 * ungrounded is ever shown.
 */
export async function* streamAccountQuestion(
  accountId: string,
  question: string
): AsyncGenerator<AskStreamChunk> {
  const facts = await retrieveForQuestion(accountId, question);

  // Chunk 1 — instant, deterministic, grounded. No model on this path.
  yield {
    type: "preamble",
    factCount: facts.length,
    text:
      facts.length === 0
        ? "I couldn't find data in your account to answer that — try asking about renewals, risk, vendor spend, savings, or compliance."
        : `Reading ${facts.length} relevant fact${facts.length === 1 ? "" : "s"} from your account…`,
  };

  // Chunk 2 — the validated grounded answer (model + validateAnswer + metering).
  const answer = await reasonAndMeter(accountId, question, facts);
  yield { type: "answer", answer };
}
