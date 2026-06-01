/**
 * Grounded Ask assistant composer. The whole pipeline is READ-ONLY:
 *   classify → retrieve (deterministic dispatch, or a configured vector
 *   provider) → reason (getReasoningProvider().answerQuestion, which applies
 *   `validateAnswer` internally) → return.
 * It stores nothing, writes no audit log, and never crosses the autonomy
 * boundary — it only answers from the account's own data.
 */
import { getReasoningProvider } from "@server/infrastructure/ai";
import { getIntentRouter } from "@server/infrastructure/ai/intent/router";
import type { GroundedAnswer } from "@server/infrastructure/ai/reasoning/types";
import { getRetriever } from "@server/infrastructure/retriever";
import { retrieveFacts } from "./retrieve";

export async function answerAccountQuestion(
  accountId: string,
  question: string
): Promise<GroundedAnswer> {
  // Semantic intent routing when AI is on (understands paraphrases/typos), with
  // a deterministic keyword fallback. The deterministic keyword router can't do
  // this — it only matches fixed keywords.
  const intent = await getIntentRouter().classify(question);

  // Prefer a configured vector retriever; otherwise the deterministic SQL
  // dispatch (the shipped default).
  const vector = getRetriever();
  const facts = vector
    ? await vector.retrieve({ accountId, question, intent })
    : await retrieveFacts(accountId, intent, question);

  return getReasoningProvider().answerQuestion({ question, facts });
}
