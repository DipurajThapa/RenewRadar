/**
 * Shared test harness for DB-backed Vitest suites.
 *
 * Why this file exists:
 *   - `src/lib/db/index.ts` instantiates a singleton connection at import time.
 *     We import it here once so every query module shares the same client.
 *   - We run drizzle-kit migrations against the test DB at the start of the
 *     suite (idempotent), then truncate the data tables before each test so
 *     suites are order-independent.
 *
 * Why not real Inngest / Clerk / Stripe:
 *   - These tests target the query/mutation layer. Anything that depends on
 *     external services should be tested in a dedicated suite with mocks.
 */
import { execSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountsTable,
  auditLogTable,
  integrationsTable,
  invitationsTable,
  notificationsTable,
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@/lib/db/schema";

let migrationsRun = false;

/**
 * Run migrations against the test DB exactly once per process. Safe to call
 * from multiple suites — only the first invocation does the work.
 */
export async function ensureMigrated(): Promise<void> {
  if (migrationsRun) return;
  // Use drizzle-kit migrate so the schema matches production exactly. The CLI
  // reads DATABASE_URL from the environment (we already set it in vitest.setup.ts).
  execSync("pnpm exec drizzle-kit migrate", {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  migrationsRun = true;
}

/**
 * Truncate all data tables. Cheaper than re-running migrations between tests.
 * `RESTART IDENTITY CASCADE` resets sequences and follows FK cascades.
 *
 * Order doesn't matter with CASCADE, but listing every table guarantees the
 * truncate stays comprehensive if new tables are added without updating this
 * helper (the truncate will fail loudly).
 */
export async function truncateAll(): Promise<void> {
  await db.execute(sql`
    truncate table
      ${auditLogTable},
      ${notificationsTable},
      ${savingsRecordsTable},
      ${integrationsTable},
      ${invitationsTable},
      ${renewalEventsTable},
      ${subscriptionsTable},
      ${vendorsTable},
      ${usersTable},
      ${accountsTable}
    restart identity cascade
  `);
}

/**
 * Seed two independent accounts (A and B) with a vendor, a subscription, a
 * renewal event, a notification, and an audit log entry each. The two accounts
 * have *no* shared data — they exist only to prove queries scoped to A never
 * see B's rows.
 *
 * Returns the IDs every test needs.
 */
export type SeedTwoAccountsResult = {
  accountA: { id: string; userId: string; vendorId: string; subscriptionId: string; renewalEventId: string };
  accountB: { id: string; userId: string; vendorId: string; subscriptionId: string; renewalEventId: string };
};

export async function seedTwoAccounts(): Promise<SeedTwoAccountsResult> {
  // Today + 60 days = term end; notice period 30 = deadline in 30 days
  const today = new Date();
  const termEnd = new Date(today);
  termEnd.setUTCDate(termEnd.getUTCDate() + 60);
  const termEndStr = termEnd.toISOString().split("T")[0]!;
  const noticeDeadline = new Date(today);
  noticeDeadline.setUTCDate(noticeDeadline.getUTCDate() + 30);
  const noticeDeadlineStr = noticeDeadline.toISOString().split("T")[0]!;
  const termStartStr = today.toISOString().split("T")[0]!;

  return db.transaction(async (tx) => {
    const [a] = await tx
      .insert(accountsTable)
      .values({ name: "Account A", billingEmail: "a@example.test" })
      .returning();
    const [b] = await tx
      .insert(accountsTable)
      .values({ name: "Account B", billingEmail: "b@example.test" })
      .returning();
    if (!a || !b) throw new Error("Failed to seed accounts");

    const [aUser] = await tx
      .insert(usersTable)
      .values({
        accountId: a.id,
        clerkUserId: `clerk_a_${a.id}`,
        workEmail: "owner@a.example.test",
        fullName: "Owner A",
      })
      .returning();
    const [bUser] = await tx
      .insert(usersTable)
      .values({
        accountId: b.id,
        clerkUserId: `clerk_b_${b.id}`,
        workEmail: "owner@b.example.test",
        fullName: "Owner B",
      })
      .returning();
    if (!aUser || !bUser) throw new Error("Failed to seed users");

    const [aVendor] = await tx
      .insert(vendorsTable)
      .values({ accountId: a.id, name: "Vendor A" })
      .returning();
    const [bVendor] = await tx
      .insert(vendorsTable)
      .values({ accountId: b.id, name: "Vendor B" })
      .returning();
    if (!aVendor || !bVendor) throw new Error("Failed to seed vendors");

    const [aSub] = await tx
      .insert(subscriptionsTable)
      .values({
        accountId: a.id,
        vendorId: aVendor.id,
        productName: "Product A",
        billingCycle: "annual",
        termStartDate: termStartStr,
        termEndDate: termEndStr,
        autoRenew: true,
        noticePeriodDays: 30,
        totalSeats: 10,
        unitPriceCents: 10_000,
        totalCostPerPeriodCents: 100_000,
        status: "active",
        ownerUserId: aUser.id,
      })
      .returning();
    const [bSub] = await tx
      .insert(subscriptionsTable)
      .values({
        accountId: b.id,
        vendorId: bVendor.id,
        productName: "Product B",
        billingCycle: "annual",
        termStartDate: termStartStr,
        termEndDate: termEndStr,
        autoRenew: true,
        noticePeriodDays: 30,
        totalSeats: 5,
        unitPriceCents: 20_000,
        totalCostPerPeriodCents: 100_000,
        status: "active",
        ownerUserId: bUser.id,
      })
      .returning();
    if (!aSub || !bSub) throw new Error("Failed to seed subscriptions");

    const [aRenewal] = await tx
      .insert(renewalEventsTable)
      .values({
        accountId: a.id,
        subscriptionId: aSub.id,
        renewalDate: termEndStr,
        noticeDeadline: noticeDeadlineStr,
        status: "upcoming",
      })
      .returning();
    const [bRenewal] = await tx
      .insert(renewalEventsTable)
      .values({
        accountId: b.id,
        subscriptionId: bSub.id,
        renewalDate: termEndStr,
        noticeDeadline: noticeDeadlineStr,
        status: "upcoming",
      })
      .returning();
    if (!aRenewal || !bRenewal) throw new Error("Failed to seed renewal events");

    await tx.insert(notificationsTable).values([
      {
        accountId: a.id,
        userId: aUser.id,
        channel: "email",
        trigger: "notice_window_30",
        entityType: "renewal_event",
        entityId: aRenewal.id,
        status: "sent",
        sentAt: new Date(),
      },
      {
        accountId: b.id,
        userId: bUser.id,
        channel: "email",
        trigger: "notice_window_30",
        entityType: "renewal_event",
        entityId: bRenewal.id,
        status: "sent",
        sentAt: new Date(),
      },
    ]);

    await tx.insert(auditLogTable).values([
      {
        accountId: a.id,
        actorUserId: aUser.id,
        action: "subscription.created",
        targetEntityType: "subscription",
        targetEntityId: aSub.id,
      },
      {
        accountId: b.id,
        actorUserId: bUser.id,
        action: "subscription.created",
        targetEntityType: "subscription",
        targetEntityId: bSub.id,
      },
    ]);

    return {
      accountA: {
        id: a.id,
        userId: aUser.id,
        vendorId: aVendor.id,
        subscriptionId: aSub.id,
        renewalEventId: aRenewal.id,
      },
      accountB: {
        id: b.id,
        userId: bUser.id,
        vendorId: bVendor.id,
        subscriptionId: bSub.id,
        renewalEventId: bRenewal.id,
      },
    };
  });
}
