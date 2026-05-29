import { and, eq, lt } from "drizzle-orm";
import { inngest } from "@server/jobs/client";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  auditLogTable,
} from "@server/infrastructure/db/schema";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";
import type { PlanTier } from "@server/domain/billing/tier-definitions";

/**
 * Retention windows by tier (days). Mirrors the values surfaced in
 * tier-definitions FEATURE_MATRIX so we don't drift; see the test below for
 * the cross-reference assertion.
 *
 *   Free       30 days
 *   Starter    12 months  (365)
 *   Growth     24 months  (730)
 *   Pro        36 months  (1095)
 *   Enterprise 7 years    (2555)
 */
const RETENTION_DAYS_BY_TIER: Record<PlanTier, number> = {
  free_forever: 30,
  starter: 365,
  growth: 730,
  pro: 1095,
  enterprise: 2555,
};

/**
 * Daily audit-log retention enforcement (06:00 UTC).
 *
 * Inngest wrapper around `runAuditRetention(now)` — that pure function
 * is exported so tests can pin behaviour at a controlled timestamp.
 */
export const auditRetentionEnforcement = inngest.createFunction(
  {
    id: "audit-retention-enforcement",
    name: "Daily audit-log retention enforcement",
    retries: 3,
  },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    return step.run("retention-sweep", () =>
      runAuditRetention(new Date())
    );
  }
);

/**
 * For every account, delete audit_log entries older than the account's
 * tier retention. Posts a single `audit_log.purged` entry per account
 * so the deletion itself is auditable (the next run will eventually
 * sweep that entry too — that's fine, the recursion terminates).
 *
 * Exposed for tests under a controlled `now`.
 */
export async function runAuditRetention(now: Date): Promise<{
  accountsProcessed: number;
  totalPurged: number;
}> {
  const accounts = await db.select().from(accountsTable);

  let totalPurged = 0;
  let accountsProcessed = 0;

  for (const account of accounts) {
    const days = RETENTION_DAYS_BY_TIER[account.planTier];
    if (!days || !Number.isFinite(days)) {
      // Skip unknown tiers — better to retain than to silently delete on
      // a misconfiguration.
      continue;
    }

    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const purgedResult = await db
      .delete(auditLogTable)
      .where(
        and(
          eq(auditLogTable.accountId, account.id),
          lt(auditLogTable.createdAt, cutoff)
        )
      )
      .returning({ id: auditLogTable.id });
    const purgedCount = purgedResult.length;

    if (purgedCount > 0) {
      await writeAuditLog(db, {
        accountId: account.id,
        actorUserId: null, // system action
        action: AUDIT_ACTIONS.auditLogPurged,
        target: { entityType: "audit_log", entityId: account.id },
        after: {
          count: purgedCount,
          cutoffIso: cutoff.toISOString(),
          tier: account.planTier,
          retentionDays: days,
        },
      });
      totalPurged += purgedCount;
    }
    accountsProcessed++;
  }

  return { accountsProcessed, totalPurged };
}
