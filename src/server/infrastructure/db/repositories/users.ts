import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { usersTable } from "@server/infrastructure/db/schema";

export type AccountUserOption = {
  id: string;
  fullName: string | null;
  workEmail: string;
};

/**
 * Members of an account, sorted by name (falling back to email).
 * Used to populate Owner selectors on the subscription form.
 */
export async function listAccountUsers(
  accountId: string
): Promise<AccountUserOption[]> {
  return db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      workEmail: usersTable.workEmail,
    })
    .from(usersTable)
    .where(eq(usersTable.accountId, accountId))
    .orderBy(asc(usersTable.fullName), asc(usersTable.workEmail));
}

/**
 * Defense-in-depth check: confirm a user ID belongs to the given account
 * before assigning it as an owner. Returns true only on a positive match.
 */
export async function userBelongsToAccount(
  accountId: string,
  userId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.accountId, accountId), eq(usersTable.id, userId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Count of users currently seated against an account's plan.
 *
 * Archived users (P7.2) have been moved to `user_archive` and no longer
 * appear in `users` at all — a removed user automatically frees a seat
 * without any predicate filter here. The query stays simple.
 */
export async function countActiveUsers(accountId: string): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(usersTable)
    .where(eq(usersTable.accountId, accountId));
  return row?.count ?? 0;
}
