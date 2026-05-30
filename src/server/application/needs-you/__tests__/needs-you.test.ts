/**
 * buildNeedsYouQueue (P2-S5) — the converged cross-type queue. Verifies that a
 * renewal in its notice window surfaces as a `renewal` item, that the queue is
 * ranked, that per-type counts are reported, and that it never leaks across
 * accounts.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { renewalEventsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { buildNeedsYouQueue } from "@server/application/needs-you";

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

describe("buildNeedsYouQueue", () => {
  it("surfaces an in-window renewal as a ranked renewal item", async () => {
    const q = await buildNeedsYouQueue(ids.accountA.id);
    const renewal = q.items.find((i) => i.type === "renewal");
    expect(renewal).toBeDefined();
    expect(renewal?.id).toBe(`renewal:${ids.accountA.renewalEventId}`);
    expect(renewal?.href).toContain(ids.accountA.subscriptionId);
    expect(renewal?.urgencyScore).toBeGreaterThan(0);
    expect(q.countsByType.renewal).toBeGreaterThanOrEqual(1);
  });

  it("reports a count for every type (zero for empty inboxes)", async () => {
    const q = await buildNeedsYouQueue(ids.accountA.id);
    expect(q.countsByType).toEqual(
      expect.objectContaining({
        review: 0,
        approval: 0,
        request: 0,
        spend: 0,
      })
    );
  });

  it("is ranked by urgency descending", async () => {
    const q = await buildNeedsYouQueue(ids.accountA.id);
    for (let i = 1; i < q.items.length; i++) {
      expect(q.items[i - 1]!.urgencyScore).toBeGreaterThanOrEqual(
        q.items[i]!.urgencyScore
      );
    }
  });

  it("never leaks another account's items", async () => {
    const q = await buildNeedsYouQueue(ids.accountB.id);
    expect(
      q.items.some((i) => i.id === `renewal:${ids.accountA.renewalEventId}`)
    ).toBe(false);
  });
});
