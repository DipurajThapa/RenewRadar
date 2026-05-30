/**
 * getAccountRiskSummary (P2-S4) — aggregate band distribution + top-at-risk
 * item + an offline narrative, reusing the action-queue rows. Pins:
 *   - band counts sum to the total
 *   - a top-at-risk item + insight are produced when there's exposure
 *   - an account with no active actionable renewals returns the empty summary
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalEventsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { getAccountRiskSummary } from "@server/application/account-risk";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  await db
    .update(renewalEventsTable)
    .set({ status: "notice_window" })
    .where(eq(renewalEventsTable.id, ids.accountA.renewalEventId));
});

describe("getAccountRiskSummary", () => {
  it("aggregates the band distribution and narrates the top risk", async () => {
    const s = await getAccountRiskSummary(ids.accountA.id);
    expect(s.total).toBeGreaterThanOrEqual(1);
    expect(s.highCount + s.mediumCount + s.lowCount).toBe(s.total);
    expect(s.topAtRisk).not.toBeNull();
    expect(s.topAtRisk?.subscriptionId).toBe(ids.accountA.subscriptionId);
    expect(s.insight).not.toBeNull();
    expect(s.insight?.headline).toBeTruthy();
  });

  it("is tenant-scoped (account B's summary excludes A's renewal)", async () => {
    const sB = await getAccountRiskSummary(ids.accountB.id);
    // B's seeded event isn't in the notice window; if it has rows they're its
    // own — never A's subscription.
    expect(sB.topAtRisk?.subscriptionId).not.toBe(ids.accountA.subscriptionId);
  });

  it("returns the empty summary when no active actionable renewals exist", async () => {
    // Flip the only subscription out of 'active' → action-queue excludes it.
    await db
      .update(subscriptionsTable)
      .set({ status: "draft" })
      .where(eq(subscriptionsTable.id, ids.accountA.subscriptionId));
    const s = await getAccountRiskSummary(ids.accountA.id);
    expect(s.total).toBe(0);
    expect(s.insight).toBeNull();
    expect(s.topAtRisk).toBeNull();
  });
});
