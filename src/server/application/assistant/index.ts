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
import type { GroundedAnswer } from "@server/infrastructure/ai/reasoning/types";
import { getRetriever } from "@server/infrastructure/retriever";
import {
  recordReasoningSpend,
  resolveReasoningProvider,
} from "@server/application/ai-budget";
import { retrieveFacts } from "./retrieve";
import { semanticRetrievalEnabled, semanticRetrieveFacts } from "./semantic-retrieve";

export async function answerAccountQuestion(
  accountId: string,
  question: string
): Promise<GroundedAnswer> {
  // Semantic intent routing when AI is on (understands paraphrases/typos), with
  // a deterministic keyword fallback. The deterministic keyword router can't do
  // this — it only matches fixed keywords.
  const intent = await getIntentRouter().classify(question);

  // Retrieval priority:
  //   1. a configured EXTERNAL vector store (RETRIEVER_PROVIDER), if any;
  //   2. the in-app SEMANTIC retriever (default ON) — embeds + ranks a broad pool
  //      of the account's real facts, handling paraphrased / off-menu questions;
  //   3. the deterministic single-intent SQL dispatch (always-correct fallback).
  const vector = getRetriever();
  const facts = vector
    ? await vector.retrieve({ accountId, question, intent })
    : semanticRetrievalEnabled()
      ? await semanticRetrieveFacts(accountId, question, intent)
      : await retrieveFacts(accountId, intent, question);

  // Pick the provider under the account's monthly reasoning budget (F3): within
  // budget → configured engine; over budget → deterministic (free).
  const budget = await resolveReasoningProvider(accountId);
  const answer = await budget.provider.answerQuestion({ question, facts });

  // Charge the actual token cost (no-op for the deterministic/offline path).
  await recordReasoningSpend({ accountId, surface: "ask", meta: answer.meta });

  return answer;
}
