/**
 * Dev seed script. Wipes and re-creates demo data.
 *
 * Usage:
 *   pnpm db:seed   (auto-loads .env.local)
 *
 * Safety: this DELETES all customer data. Never run in production.
 *
 * The account + user IDs are pinned to match DEMO_ACCOUNT_ID / DEMO_USER_ID
 * in src/lib/demo-mode.ts so the auth bypass returns the seeded row.
 */

import { db } from "../../src/server/infrastructure/db/client";
import {
  accountsTable,
  usersTable,
  vendorsTable,
  subscriptionsTable,
  renewalEventsTable,
  notificationsTable,
  auditLogTable,
} from "../../src/server/infrastructure/db/schema";
import { calculateNoticeDeadline } from "../../src/server/domain/notice-deadline/calculate";
import {
  DEMO_ACCOUNT_ID,
  DEMO_CLERK_USER_ID,
  DEMO_USER_ID,
} from "../../src/server/middleware/demo-mode";

async function seed() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed in production.");
    process.exit(1);
  }

  console.log("🌱 Seeding...");

  // Wipe in FK-safe order
  await db.delete(notificationsTable);
  await db.delete(auditLogTable);
  await db.delete(renewalEventsTable);
  await db.delete(subscriptionsTable);
  await db.delete(vendorsTable);
  await db.delete(usersTable);
  await db.delete(accountsTable);

  // Insert account + user with PINNED demo IDs so the auth bypass works.
  const [account] = await db
    .insert(accountsTable)
    .values({
      id: DEMO_ACCOUNT_ID,
      name: "Acme Demo Corp",
      billingEmail: "demo@example.com",
      planTier: "starter",
      timezone: "America/Los_Angeles",
    })
    .returning();

  if (!account) throw new Error("Failed to create demo account");

  const [user] = await db
    .insert(usersTable)
    .values({
      id: DEMO_USER_ID,
      accountId: account.id,
      clerkUserId: DEMO_CLERK_USER_ID,
      workEmail: "demo@example.com",
      fullName: "Demo User",
      role: "owner",
    })
    .returning();

  if (!user) throw new Error("Failed to create demo user");

  const vendorNames = [
    "Atlassian",
    "Datadog",
    "Figma",
    "Notion",
    "Slack",
    "HubSpot",
  ];
  const vendors = await db
    .insert(vendorsTable)
    .values(
      vendorNames.map((name) => ({
        accountId: account.id,
        name,
      }))
    )
    .returning();

  // Subscriptions with notice deadlines staggered: 3, 6, 18, 36, 60, 90 days out
  const today = new Date();
  const noticeOffsets = [3, 6, 18, 36, 60, 90];

  for (let i = 0; i < vendors.length; i++) {
    const vendor = vendors[i]!;
    const offset = noticeOffsets[i] ?? 30;
    // notice = today + offset, term_end = notice + notice_period (30 days)
    const noticeDate = new Date(today);
    noticeDate.setDate(today.getDate() + offset);
    const termEnd = new Date(noticeDate);
    termEnd.setDate(noticeDate.getDate() + 30);

    const termEndDate = termEnd.toISOString().split("T")[0]!;
    const termStartDate = new Date(termEnd);
    termStartDate.setFullYear(termStartDate.getFullYear() - 1);

    const totalSeats = 10 + i * 5;
    const unitPriceCents = 5000 + i * 1000;

    const productNames: Record<string, string> = {
      Atlassian: "Jira Software",
      Datadog: "Pro Plan",
      Figma: "Organization",
      Notion: "Plus",
      Slack: "Pro",
      HubSpot: "Sales Hub",
    };

    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        accountId: account.id,
        vendorId: vendor.id,
        productName: productNames[vendor.name] ?? `${vendor.name} Plan`,
        planName: "Standard",
        billingCycle: "annual",
        termStartDate: termStartDate.toISOString().split("T")[0]!,
        termEndDate,
        autoRenew: true,
        noticePeriodDays: 30,
        totalSeats,
        unitPriceCents,
        totalCostPerPeriodCents: totalSeats * unitPriceCents,
        status: "active",
        ownerUserId: user.id,
        notes:
          i === 0 ? "Need to decide on this one this week — talk to Sarah" : null,
      })
      .returning();

    if (!sub) continue;

    const noticeDeadline = calculateNoticeDeadline(termEndDate, 30);
    await db.insert(renewalEventsTable).values({
      subscriptionId: sub.id,
      accountId: account.id,
      renewalDate: termEndDate,
      noticeDeadline: noticeDeadline.toISOString().split("T")[0]!,
      status:
        offset <= 7
          ? "action_needed"
          : offset <= 30
            ? "notice_window"
            : "upcoming",
    });

    // Seed an audit log entry per subscription so Recent Activity shows data
    await db.insert(auditLogTable).values({
      accountId: account.id,
      actorUserId: user.id,
      action: "subscription.created",
      targetEntityType: "subscription",
      targetEntityId: sub.id,
      after: { source: "demo_seed" } as Record<string, unknown>,
    });

    // Seed an in-app notification for subscriptions whose notice deadline is
    // imminent so the bell badge isn't empty in the demo. Match the same
    // threshold logic as the cron — only enqueue if today's offset lands on
    // one of the canonical thresholds.
    const threshold =
      offset <= 1
        ? 1
        : offset <= 3
          ? 3
          : offset <= 7
            ? 7
            : offset <= 14
              ? 14
              : offset <= 30
                ? 30
                : null;
    if (threshold !== null) {
      await db.insert(notificationsTable).values({
        accountId: account.id,
        userId: user.id,
        channel: "in_app",
        trigger: `notice_window_${threshold}`,
        entityType: "subscription",
        entityId: sub.id,
        status: "queued",
        payload: {
          threshold,
          vendorName: vendor.name,
          productName: productNames[vendor.name] ?? `${vendor.name} Plan`,
        },
      });
    }
  }

  console.log(
    `✅ Seeded ${vendors.length} subscriptions for ${account.name} (${account.id}).`
  );
  console.log(`   Notice deadlines staggered at 3/6/18/36/60/90 days out.`);
  console.log("");
  console.log("Next: `pnpm dev` and open http://localhost:3000/dashboard");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
