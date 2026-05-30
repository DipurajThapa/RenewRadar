/**
 * Grounded Ask assistant composer. The whole pipeline is READ-ONLY:
 *   classify → retrieve (deterministic dispatch, or a configured vector
 *   provider) → reason (getReasoningProvider().answerQuestion, which applies
 *   `validateAnswer` internally) → return.
 * It stores nothing, writes no audit log, and never crosses the autonomy
 * boundary — it only answers from the account's own data.
 */
import { classifyIntent } from "@server/domain/assistant/intent";
import { getReasoningProvider } from "@server/infrastructure/ai";
import type { GroundedAnswer } from "@server/infrastructure/ai/reasoning/types";
import { getRetriever } from "@server/infrastructure/retriever";
import { retrieveFacts } from "./retrieve";

export async function answerAccountQuestion(
  accountId: string,
  question: string
): Promise<GroundedAnswer> {
  const intent = classifyIntent(question);

  // Prefer a configured vector retriever; otherwise the deterministic SQL
  // dispatch (the shipped default).
  const vector = getRetriever();
  const facts = vector
    ? await vector.retrieve({ accountId, question, intent })
    : await retrieveFacts(accountId, intent, question);

  return getReasoningProvider().answerQuestion({ question, facts });
}
