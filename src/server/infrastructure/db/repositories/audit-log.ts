/**
 * Audit-log read queries.
 *
 * The audit-log write path lives in
 * `src/server/infrastructure/audit-log/writer.ts` (and is the single
 * canonical entry point). This file owns the read side — recent activity
 * for the dashboard widget and the paginated viewer at `/settings/audit`.
 *
 * Split out of `dashboard.ts` so the responsibilities are clean: dashboard
 * is product KPIs, this file is the audit log.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  auditLogTable,
  usersTable,
} from "@server/infrastructure/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Recent Activity (dashboard widget — small N, no pagination)
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityEntry = {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  createdAt: Date;
};

export async function getRecentActivity(
  accountId: string,
  limit = 8
): Promise<ActivityEntry[]> {
  return db
    .select({
      id: auditLogTable.id,
      actorName: usersTable.fullName,
      actorEmail: usersTable.workEmail,
      action: auditLogTable.action,
      targetEntityType: auditLogTable.targetEntityType,
      targetEntityId: auditLogTable.targetEntityId,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.actorUserId, usersTable.id))
    .where(eq(auditLogTable.accountId, accountId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Audit Log (paginated viewer)
// ─────────────────────────────────────────────────────────────────────────────

export type AuditLogEntry = {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
};

export type AuditLogFilter = {
  entityType?: string;
  /** Cursor: return entries strictly older than this createdAt. */
  cursor?: Date;
  limit?: number;
};

/**
 * Paginated audit log query for the /settings/audit viewer.
 *
 * Returns one page of entries scoped to the account, filterable by entity
 * type. Pagination uses a `createdAt < cursor` keyset rather than offset —
 * cheap on the (accountId, createdAt) index and stable when new rows land
 * mid-pagination.
 */
export async function listAuditEntries(
  accountId: string,
  filter: AuditLogFilter = {}
): Promise<AuditLogEntry[]> {
  const limit = Math.min(filter.limit ?? 50, 200);

  const conditions = [eq(auditLogTable.accountId, accountId)];
  if (filter.entityType) {
    conditions.push(eq(auditLogTable.targetEntityType, filter.entityType));
  }
  if (filter.cursor) {
    conditions.push(sql`${auditLogTable.createdAt} < ${filter.cursor}`);
  }

  return db
    .select({
      id: auditLogTable.id,
      actorName: usersTable.fullName,
      actorEmail: usersTable.workEmail,
      action: auditLogTable.action,
      targetEntityType: auditLogTable.targetEntityType,
      targetEntityId: auditLogTable.targetEntityId,
      before: auditLogTable.before,
      after: auditLogTable.after,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.actorUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
}

/**
 * Distinct entity types observed in the audit log for an account, used to
 * populate the filter dropdown. Cheap (DISTINCT on a small column).
 */
export async function listAuditEntityTypes(
  accountId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ entityType: auditLogTable.targetEntityType })
    .from(auditLogTable)
    .where(eq(auditLogTable.accountId, accountId));
  return rows
    .map((r) => r.entityType)
    .filter((v): v is string => typeof v === "string");
}
