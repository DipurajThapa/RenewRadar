import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { invitationsTable } from "@server/infrastructure/db/schema";
import type { Invitation } from "@server/infrastructure/db/schema";

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  invitedAt: Date;
  expiresAt: Date;
};

/**
 * List unaccepted invitations for an account. Expired invites are excluded —
 * they're surfaced via a separate "expired" list when needed.
 */
export async function listPendingInvitations(
  accountId: string
): Promise<PendingInvitation[]> {
  const rows = await db
    .select({
      id: invitationsTable.id,
      email: invitationsTable.email,
      role: invitationsTable.role,
      invitedAt: invitationsTable.createdAt,
      expiresAt: invitationsTable.expiresAt,
      acceptedAt: invitationsTable.acceptedAt,
    })
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.accountId, accountId),
        gt(invitationsTable.expiresAt, new Date())
      )
    );
  return rows
    .filter((r) => !r.acceptedAt)
    .map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role as string,
      invitedAt: r.invitedAt,
      expiresAt: r.expiresAt,
    }));
}

/**
 * Count of pending (unaccepted + unexpired) invitations for an account.
 *
 * Used by the seat-cap enforcement to bound (active users + pending invites)
 * against the plan's `maxUsers`. Expired invites are excluded — they cannot
 * convert to a seat anymore. Accepted invites convert into a User row, so
 * counting them separately would double-count.
 */
export async function countPendingInvitations(
  accountId: string
): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.accountId, accountId),
        isNull(invitationsTable.acceptedAt),
        gt(invitationsTable.expiresAt, new Date())
      )
    );
  return row?.count ?? 0;
}

/**
 * Look up an invitation by token (for the accept page). Returns null if the
 * token doesn't match or the invitation has already been accepted/expired.
 */
export async function getInvitationByToken(
  token: string
): Promise<Invitation | null> {
  if (!token) return null;
  const rows = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.acceptedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}
