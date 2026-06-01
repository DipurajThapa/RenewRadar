/**
 * System health aggregator — what the ops/admin "is anything broken?" page
 * reads. Pure read-only; no side effects.
 *
 * What we report:
 *   - Database connectivity (the page wouldn't render at all if it broke,
 *     but we surface a successful round-trip + latency for the probe)
 *   - Notification delivery rate over the last 7 days, per channel
 *   - AI extraction success rate over the last 30 days
 *   - Open extraction problems (failed + image_only_pdf detection)
 *   - Configured providers — surface which AI/OCR/storage/rate-limit
 *     implementations are wired (lets ops verify env vars actually took
 *     effect without grepping logs)
 *   - Integration health (count of enabled integrations per kind)
 *   - AI pages monthly budget consumption as % of cap
 *
 * Tenant-scoped: every aggregate filters on accountId. The page reads only
 * the caller's account — no cross-account leakage even via a misclick.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractionRunsTable,
  documentsTable,
  integrationsTable,
  notificationsTable,
} from "@server/infrastructure/db/schema";
import {
  TIER_DEFINITIONS,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";
import { getMonthlyPagesUsed } from "@server/infrastructure/db/repositories/ai-extractions";
import { getMonthlyReasoningUsage } from "@server/infrastructure/db/repositories/ai-reasoning-usage";
import { sharedMeter } from "@server/infrastructure/ai/local-llm/usage";
import { getResponseCacheStats } from "@server/infrastructure/ai/local-llm/client";
import { getRateLimit } from "@server/infrastructure/rate-limit";
import {
  getExtractionProvider,
  getInsightProvider,
} from "@server/infrastructure/ai";
import { getOcrProvider } from "@server/infrastructure/ocr";
import { getDocumentStorage } from "@server/infrastructure/storage";

export type SystemHealth = {
  /** Round-trip DB ping latency in milliseconds. */
  dbLatencyMs: number;
  /** Snapshot of which provider implementations are live. */
  providers: {
    aiExtraction: string;
    aiInsights: string;
    ocr: string;
    storage: string;
    rateLimit: string;
  };
  notifications: NotificationHealth;
  extractions: ExtractionHealth;
  /** Open problems the user should act on. */
  openIssues: {
    failedExtractions: number;
    documentsNeedingAttention: number;
    notificationFailures7d: number;
  };
  aiBudget: {
    usedThisMonth: number;
    cap: number;
    capIsFinite: boolean;
    percentUsed: number | null;
  };
  integrations: IntegrationHealth[];
  /** AI serving observability (Phase B/B6): token usage, cache, breaker, spend. */
  serving: ServingHealth;
  /** Overall traffic-light verdict — what the badge at the top renders. */
  overall: "healthy" | "degraded" | "critical";
};

export type ServingHealth = {
  /** Process-wide LLM usage since boot (in-memory meter). */
  process: {
    calls: number;
    totalTokens: number;
    costUsdMicros: number;
    avgTokensPerCall: number;
  };
  /** Response-cache effectiveness (the cost lever). */
  cache: { hits: number; misses: number; hitRatePct: number; size: number };
  /** This account's reasoning spend this month vs its tier cap (F3). */
  reasoning: {
    callsThisMonth: number;
    tokensThisMonth: number;
    costThisMonthUsdMicros: number;
    capUsdMicros: number;
    capIsFinite: boolean;
    percentUsed: number | null;
  };
};

export type NotificationHealth = {
  windowDays: 7;
  total: number;
  byChannel: Array<{
    channel: string;
    sent: number;
    failed: number;
    queued: number;
    /** Percentage 0-100, null when nothing was attempted. */
    successRatePct: number | null;
  }>;
};

export type ExtractionHealth = {
  windowDays: 30;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  successRatePct: number | null;
};

export type IntegrationHealth = {
  kind: string;
  enabled: boolean;
  /** ISO timestamp of last update. */
  updatedAt: string;
};

/**
 * Build the system-health report for the given account. Heavy aggregate
 * queries but bounded — runs at the admin page load, not on every request.
 */
export async function getSystemHealth(
  accountId: string,
  accountPlanTier: PlanTier
): Promise<SystemHealth> {
  const dbStartTs = Date.now();
  await db.execute(sql`select 1`);
  const dbLatencyMs = Date.now() - dbStartTs;

  const providers = getProviderSnapshot();
  const notifications = await getNotificationHealth(accountId);
  const extractions = await getExtractionHealth(accountId);
  const integrations = await getIntegrationHealth(accountId);
  const aiBudget = await getAiBudget(accountId, accountPlanTier);
  const serving = await getServingHealth(accountId, accountPlanTier);
  const documentsNeedingAttention = await countDocumentsNeedingAttention(
    accountId
  );

  const notificationFailures7d = notifications.byChannel.reduce(
    (sum, c) => sum + c.failed,
    0
  );

  const overall = deriveOverall({
    failedExtractions: extractions.failed,
    notificationFailures: notificationFailures7d,
    documentsNeedingAttention,
  });

  return {
    dbLatencyMs,
    providers,
    notifications,
    extractions,
    openIssues: {
      failedExtractions: extractions.failed,
      documentsNeedingAttention,
      notificationFailures7d,
    },
    aiBudget,
    integrations,
    serving,
    overall,
  };
}

async function getServingHealth(
  accountId: string,
  planTier: PlanTier
): Promise<ServingHealth> {
  const meter = sharedMeter.stats();
  const cache = getResponseCacheStats();
  const usage = await getMonthlyReasoningUsage(accountId);
  const capUsdMicros =
    TIER_DEFINITIONS[planTier].limits.aiReasoningUsdMicrosPerMonth;
  const capIsFinite = Number.isFinite(capUsdMicros);
  return {
    process: {
      calls: meter.calls,
      totalTokens: meter.totalTokens,
      costUsdMicros: meter.costUsdMicros,
      avgTokensPerCall: meter.avgTokens,
    },
    cache: {
      hits: cache.hits,
      misses: cache.misses,
      hitRatePct: cache.hitRatePct,
      size: cache.size,
    },
    reasoning: {
      callsThisMonth: usage.calls,
      tokensThisMonth: usage.promptTokens + usage.completionTokens,
      costThisMonthUsdMicros: usage.costUsdMicros,
      capUsdMicros,
      capIsFinite,
      percentUsed:
        capIsFinite && capUsdMicros > 0
          ? Math.round((usage.costUsdMicros / capUsdMicros) * 100)
          : null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-aggregations
// ─────────────────────────────────────────────────────────────────────────

function getProviderSnapshot(): SystemHealth["providers"] {
  // We call the factories but only read their public `providerName`/`name`
  // strings. No actual provider work runs.
  const ai = getExtractionProvider();
  const insights = getInsightProvider();
  const ocr = getOcrProvider();
  const storage = getDocumentStorage();
  const rl = getRateLimit();
  return {
    aiExtraction: ai.providerName,
    aiInsights: insights.providerName,
    ocr: ocr.providerName,
    storage: storage.providerName,
    rateLimit: rl.providerName,
  };
}

async function getNotificationHealth(
  accountId: string
): Promise<NotificationHealth> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);

  const rows = await db
    .select({
      channel: notificationsTable.channel,
      status: notificationsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.accountId, accountId),
        gte(notificationsTable.createdAt, since)
      )
    )
    .groupBy(notificationsTable.channel, notificationsTable.status);

  // Pivot into per-channel totals.
  const perChannel = new Map<
    string,
    { sent: number; failed: number; queued: number }
  >();
  let total = 0;
  for (const row of rows) {
    total += row.count;
    const existing = perChannel.get(row.channel) ?? {
      sent: 0,
      failed: 0,
      queued: 0,
    };
    if (row.status === "sent") existing.sent += row.count;
    else if (row.status === "failed") existing.failed += row.count;
    else existing.queued += row.count;
    perChannel.set(row.channel, existing);
  }

  const byChannel = Array.from(perChannel.entries()).map(([channel, c]) => {
    const attempted = c.sent + c.failed;
    return {
      channel,
      sent: c.sent,
      failed: c.failed,
      queued: c.queued,
      successRatePct:
        attempted === 0 ? null : Math.round((c.sent / attempted) * 1000) / 10,
    };
  });

  return { windowDays: 7, total, byChannel };
}

async function getExtractionHealth(
  accountId: string
): Promise<ExtractionHealth> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const rows = await db
    .select({
      status: aiExtractionRunsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(aiExtractionRunsTable)
    .where(
      and(
        eq(aiExtractionRunsTable.accountId, accountId),
        gte(aiExtractionRunsTable.startedAt, since)
      )
    )
    .groupBy(aiExtractionRunsTable.status);

  let succeeded = 0;
  let failed = 0;
  let running = 0;
  let total = 0;
  for (const row of rows) {
    total += row.count;
    if (row.status === "succeeded") succeeded = row.count;
    else if (row.status === "failed") failed = row.count;
    else if (row.status === "running") running = row.count;
  }
  const attempted = succeeded + failed;
  const successRatePct =
    attempted === 0 ? null : Math.round((succeeded / attempted) * 1000) / 10;
  return { windowDays: 30, total, succeeded, failed, running, successRatePct };
}

async function getIntegrationHealth(
  accountId: string
): Promise<IntegrationHealth[]> {
  const rows = await db
    .select({
      kind: integrationsTable.kind,
      enabled: integrationsTable.enabled,
      updatedAt: integrationsTable.updatedAt,
    })
    .from(integrationsTable)
    .where(eq(integrationsTable.accountId, accountId));
  return rows.map((r) => ({
    kind: r.kind,
    enabled: r.enabled,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function getAiBudget(
  accountId: string,
  planTier: PlanTier
): Promise<SystemHealth["aiBudget"]> {
  const cap = TIER_DEFINITIONS[planTier].limits.aiExtractionPagesPerMonth;
  const used = await getMonthlyPagesUsed(accountId);
  const capIsFinite = Number.isFinite(cap);
  const percentUsed =
    capIsFinite && cap > 0
      ? Math.round((used / cap) * 1000) / 10
      : capIsFinite
        ? 100 // cap === 0 — used > 0 doesn't happen but pin to "full" anyway
        : null;
  return {
    usedThisMonth: used,
    cap: capIsFinite ? cap : Number.POSITIVE_INFINITY,
    capIsFinite,
    percentUsed,
  };
}

async function countDocumentsNeedingAttention(
  accountId: string
): Promise<number> {
  // status=ready + non-null error = image-only / encrypted / empty PDFs we
  // surfaced in P2.4. status=failed = OCR/AI hard failures.
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.accountId, accountId),
        sql`(${documentsTable.textExtractionStatus} = 'failed'
             OR (${documentsTable.textExtractionStatus} = 'ready'
                 AND ${documentsTable.textExtractionError} IS NOT NULL))`
      )
    );
  return row?.count ?? 0;
}

function deriveOverall(input: {
  failedExtractions: number;
  notificationFailures: number;
  documentsNeedingAttention: number;
}): SystemHealth["overall"] {
  // Critical: lots of notifications are failing — the trust contract with
  // the customer is being broken. Anything ≥ 5 failed sends in 7 days is
  // worth a critical badge; the admin should see this immediately.
  if (input.notificationFailures >= 5) return "critical";
  // Degraded: any failures at all (in notification or extraction), or
  // documents pending attention pile up.
  if (
    input.notificationFailures > 0 ||
    input.failedExtractions > 0 ||
    input.documentsNeedingAttention > 3
  ) {
    return "degraded";
  }
  return "healthy";
}
