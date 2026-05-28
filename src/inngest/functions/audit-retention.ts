import { and, eq, lt } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import {
  accountsTable,
  auditLogTable,
} from "@/lib/db/schema";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit/write";
import type { PlanTier } from "@/lib/billing/tier-definitions";

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
 * For every account, delete audit_log entries older than the account's tier
 * retention. Posts a single audit_log.purged entry per account (so the
 * deletion itself is auditable — and the retention cap still applies to
 * that entry on the next run, which is fine).
 */
export const auditRetentionEnforcement = inngest.createFunction(
  {
    id: "audit-retention-enforcement",
    name: "Daily audit-log retention enforcement",
    retries: 3,
  },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    const accounts = await step.run("list-accounts", async () =>
      db.select().from(accountsTable)
    );

    let totalPurged = 0;
    let accountsProcessed = 0;

    for (const account of accounts) {
      const days = RETENTION_DAYS_BY_TIER[account.planTier];
      if (!days || !Number.isFinite(days)) {
        // Skip unknown tiers — better to retain than to silently delete on
        // a misconfiguration.
        continue;
      }

      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const purgedCount = await step.run(
        `purge-${account.id}`,
        async () => {
          const result = await db
            .delete(auditLogTable)
            .where(
              and(
                eq(auditLogTable.accountId, account.id),
                lt(auditLogTable.createdAt, cutoff)
              )
            )
            .returning({ id: auditLogTable.id });
          return result.length;
        }
      );

      if (purgedCount > 0) {
        await step.run(`audit-${account.id}`, async () =>
          writeAuditLog(db, {
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
          })
        );
        totalPurged += purgedCount;
      }
      accountsProcessed++;
    }

    return { accountsProcessed, totalPurged };
  }
);
