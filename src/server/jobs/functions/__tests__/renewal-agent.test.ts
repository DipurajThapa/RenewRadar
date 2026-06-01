/**
 * AI1 — the autonomous Renewal Agent. Proves the proactive inversion: a renewal
 * entering its notice window gets a brief + internal notice auto-prepped by the
 * SYSTEM (null actor), with no human click — and that it's idempotent and
 * operator-controllable (the agentAutoPrep kill-switch).
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  renewalBriefsTable,
  renewalEventsTable,
  renewalNoticeDraftsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  ensureVendor,
  createSubscriptionWithRenewalEvent,
} from "@server/application/subscriptions";
import { generateAndStoreBrief } from "@server/application/renewal-brief";
import { runRenewalAgent } from "@server/jobs/functions/renewal-agent";

let accountId: string;
let userId: string;
let subscriptionId: string;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Agent Co", billingEmail: "a@a.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "o@a.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  userId = user!.id;
  const vendor = await ensureVendor({ accountId, name: "Datadog" });
  const sub = await createSubscriptionWithRenewalEvent({
    accountId,
    actorUserId: userId,
    vendorId: vendor.id,
    data: {
      productName: "Pro",
      billingCycle: "annual",
      termStartDate: "2025-01-01",
      termEndDate: "2026-12-31",
      autoRenew: true,
      noticePeriodDays: 30,
      totalSeats: 1,
      unitPriceCents: 600_000,
    },
  });
  subscriptionId = sub.id;
  // Advance the renewal event into its notice window (the state machine does
  // this in prod; we set it directly for the test).
  await db
    .update(renewalEventsTable)
    .set({ status: "notice_window" })
    .where(eq(renewalEventsTable.subscriptionId, subscriptionId));
});

const passThrough = <T>(_id: string, fn: () => Promise<T>) => fn();

describe("runRenewalAgent", () => {
  it("auto-preps a renewal in its notice window — brief + notice, SYSTEM actor", async () => {
    const res = await runRenewalAgent(passThrough);
    expect(res.candidates).toBe(1);
    expect(res.prepped).toBe(1);
    expect(res.failed).toBe(0);

    const [brief] = await db
      .select()
      .from(renewalBriefsTable)
      .where(eq(renewalBriefsTable.subscriptionId, subscriptionId));
    expect(brief).toBeTruthy();
    expect(brief!.createdByUserId).toBeNull(); // system actor — honest provenance

    const [notice] = await db
      .select()
      .from(renewalNoticeDraftsTable)
      .where(eq(renewalNoticeDraftsTable.subscriptionId, subscriptionId));
    expect(notice).toBeTruthy();
    expect(notice!.createdByUserId).toBeNull();
    expect(notice!.bodyText).toContain("INTERNAL MEMO");
  });

  it("is idempotent — skips a subscription that already has a brief", async () => {
    await generateAndStoreBrief({ accountId, subscriptionId, actorUserId: userId });
    const res = await runRenewalAgent(passThrough);
    expect(res.candidates).toBe(0); // already prepped → not a candidate
    expect(res.prepped).toBe(0);
  });

  it("respects the kill-switch — skips accounts with agentAutoPrep off", async () => {
    await db
      .update(accountsTable)
      .set({ agentAutoPrep: false })
      .where(eq(accountsTable.id, accountId));
    const res = await runRenewalAgent(passThrough);
    expect(res.candidates).toBe(0);
  });
});
