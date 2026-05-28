import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable, usersTable } from "@server/infrastructure/db/schema";
import type { Account, User } from "@server/infrastructure/db/schema";
import { DEMO_ACCOUNT_ID, DEMO_USER_ID, isDemoMode } from "@server/middleware/demo-mode";

/**
 * Per-request memoized lookup of the current account and user.
 *
 * Behavior:
 *   - DEMO_MODE: returns the seeded demo account + user; never calls Clerk
 *   - Real mode: pulls the Clerk user ID, joins accounts/users, returns the pair
 *   - Redirects to /sign-in if not authenticated
 *   - Redirects to /setup-pending if the Clerk webhook hasn't created the DB row
 */
export const getCurrentAccountAndUser = cache(
  async (): Promise<{ account: Account; user: User }> => {
    if (isDemoMode) {
      return getDemoAccountAndUser();
    }

    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      redirect("/sign-in");
    }

    const result = await db
      .select({
        user: usersTable,
        account: accountsTable,
      })
      .from(usersTable)
      .innerJoin(accountsTable, eq(usersTable.accountId, accountsTable.id))
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (!result[0]) {
      // Edge case: Clerk user exists but DB record hasn't been created yet
      // (webhook delivery delayed or failed). Don't loop — show a pending screen.
      redirect("/setup-pending");
    }

    return {
      account: result[0].account,
      user: result[0].user,
    };
  }
);

async function getDemoAccountAndUser(): Promise<{
  account: Account;
  user: User;
}> {
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, DEMO_ACCOUNT_ID))
    .limit(1);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, DEMO_USER_ID))
    .limit(1);

  if (!account || !user) {
    throw new Error(
      "[demo-mode] Demo account or user not found in database. " +
        "Run `pnpm db:seed` to create the demo data."
    );
  }

  return { account, user };
}
