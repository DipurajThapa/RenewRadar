import { and, asc, eq } from "drizzle-orm";
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
