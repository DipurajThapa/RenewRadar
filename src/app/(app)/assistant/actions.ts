"use server";

import { z } from "zod";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { getRateLimit, ASK_POLICY } from "@server/infrastructure/rate-limit";
import { answerAccountQuestion } from "@server/application/assistant";
import type { GroundedAnswer } from "@server/infrastructure/ai/reasoning/types";

const questionSchema = z.object({
  question: z.string().trim().min(1).max(500),
});

export type AskResult =
  | { ok: true; answer: GroundedAnswer }
  | { ok: false; error: string };

/**
 * Ask the grounded assistant. Read-only — answers only from the caller's own
 * account data. Any account member (viewer+) can ask; rate-limited per user.
 */
export async function askAssistantAction(question: string): Promise<AskResult> {
  const { account, user } = await getCurrentAccountAndUser();

  try {
    requireRole(user, "viewer"); // read-only surface — everyone with access
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  const parsed = questionSchema.safeParse({ question });
  if (!parsed.success) {
    return { ok: false, error: "Please enter a question (1–500 characters)." };
  }

  const rl = await getRateLimit().check(
    `ask:${account.id}:${user.id}`,
    ASK_POLICY
  );
  if (!rl.allowed) {
    return {
      ok: false,
      error: `Too many questions — try again in ${Math.ceil(rl.resetSeconds / 60)} min.`,
    };
  }

  try {
    const answer = await answerAccountQuestion(account.id, parsed.data.question);
    return { ok: true, answer };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't answer that.",
    };
  }
}
