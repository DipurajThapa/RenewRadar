/**
 * listAgentPreppedItems — the dashboard "Prepared for you" feed (P2-S3).
 *
 * Pins the three filters that make it meaningful + safe:
 *   - only the autonomous agent's work (createdByUserId IS NULL)
 *   - only still-open renewal events (notice_window / action_needed)
 *   - account-scoped (no cross-tenant leak)
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalBriefsTable,
  renewalEventsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { generateAndStoreBrief } from "@server/application/renewal-brief";
import { listAgentPreppedItems } from "@server/infrastructure/db/repositories/renewals";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  // Put account A's renewal event into the notice window so its brief counts.
  await db
    .update(renewalEventsTable)
    .set({ status: "notice_window" })
    .where(eq(renewalEventsTable.id, ids.accountA.renewalEventId));
});

async function prepAgentBrief() {
  // actorUserId: null = the autonomous agent (SYSTEM actor).
  return generateAndStoreBrief({
    accountId: ids.accountA.id,
    subscriptionId: ids.accountA.subscriptionId,
    actorUserId: null,
  });
}

describe("listAgentPreppedItems", () => {
  it("surfaces an agent-prepped brief for an open renewal event", async () => {
    await prepAgentBrief();
    const items = await listAgentPreppedItems(ids.accountA.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.subscriptionId).toBe(ids.accountA.subscriptionId);
    expect(items[0]?.recommendedAction).toBeTruthy();
  });

  it("never leaks across accounts", async () => {
    await prepAgentBrief();
    expect(await listAgentPreppedItems(ids.accountB.id)).toEqual([]);
  });

  it("excludes human-generated briefs (createdByUserId set)", async () => {
    const brief = await prepAgentBrief();
    // A human regenerates / takes over → no longer "prepared for you".
    await db
      .update(renewalBriefsTable)
      .set({ createdByUserId: ids.accountA.userId })
      .where(eq(renewalBriefsTable.id, brief.id));
    expect(await listAgentPreppedItems(ids.accountA.id)).toEqual([]);
  });

  it("excludes briefs whose renewal event is no longer open", async () => {
    await prepAgentBrief();
    await db
      .update(renewalEventsTable)
      .set({ status: "upcoming" })
      .where(eq(renewalEventsTable.id, ids.accountA.renewalEventId));
    expect(await listAgentPreppedItems(ids.accountA.id)).toEqual([]);
  });
});
