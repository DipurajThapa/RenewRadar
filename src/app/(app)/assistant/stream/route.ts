/**
 * Streaming Ask endpoint (Phase B/B5) — Server-Sent Events. Same auth + RBAC +
 * rate-limit + validation as `askAssistantAction`, but streams the response so the
 * user sees an INSTANT grounded preamble (no model wait), then the validated
 * answer. Read-only; never acts. The chunk types come from `streamAccountQuestion`
 * (a SAFE deterministic-first preamble, then the validated `GroundedAnswer`).
 */
import { z } from "zod";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { getRateLimit, ASK_POLICY } from "@server/infrastructure/rate-limit";
import { streamAccountQuestion } from "@server/application/assistant";

export const runtime = "nodejs"; // needs the DB + local model path

const questionSchema = z.object({ question: z.string().trim().min(1).max(500) });

function sse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request): Promise<Response> {
  const { account, user } = await getCurrentAccountAndUser();

  try {
    requireRole(user, "viewer"); // read-only surface — everyone with access
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw err;
  }

  const parsed = questionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response("Please enter a question (1–500 characters).", { status: 400 });
  }

  const rl = await getRateLimit().check(`ask:${account.id}:${user.id}`, ASK_POLICY);
  if (!rl.allowed) {
    return new Response(
      `Too many questions — try again in ${Math.ceil(rl.resetSeconds / 60)} min.`,
      { status: 429 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamAccountQuestion(account.id, parsed.data.question)) {
          controller.enqueue(sse(chunk));
        }
      } catch {
        controller.enqueue(sse({ type: "error", error: "Couldn't answer that." }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
