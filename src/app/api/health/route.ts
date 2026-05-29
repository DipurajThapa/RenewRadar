import { db } from "@server/infrastructure/db/client";
import { sql } from "drizzle-orm";
import { getExtractionProvider, getInsightProvider } from "@server/infrastructure/ai";
import { getOcrProvider } from "@server/infrastructure/ocr";
import { getDocumentStorage } from "@server/infrastructure/storage";
import { getRateLimit } from "@server/infrastructure/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public health endpoint — useful as a Vercel/K8s liveness + readiness probe
 * and for ops to verify wiring without exposing sensitive state.
 *
 * Response shape (backwards-compatible — `ok` + `ts` were the original
 * fields, new fields are additive):
 *
 *   200 { ok: true, ts, dbLatencyMs, providers: {...} }
 *   503 { ok: false, error: "db_unreachable", detail }
 *
 * Provider names are safe to expose — they encode WHICH implementation is
 * wired (e.g. "anthropic" vs "heuristic-stub"), not any secrets. The DB
 * latency lets a probe alert when round-trip degrades even when the
 * connection is up.
 */
export async function GET() {
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    const dbLatencyMs = Date.now() - t0;
    return Response.json({
      ok: true,
      ts: new Date().toISOString(),
      dbLatencyMs,
      providers: {
        aiExtraction: getExtractionProvider().providerName,
        aiInsights: getInsightProvider().providerName,
        ocr: getOcrProvider().providerName,
        storage: getDocumentStorage().providerName,
        rateLimit: getRateLimit().providerName,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: "db_unreachable", detail: msg },
      { status: 503 }
    );
  }
}
