/**
 * past-due grace enforcement cron tests.
 *
 * Audit H3: pre-fix an unpaid customer could ride a paid tier indefinitely
 * because Stripe's `past_due` status was treated as a grace tier with no
 * upper bound. This cron now bounds the grace window at PAST_DUE_GRACE_DAYS
 * and force-downgrades after.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { runPastDueGraceEnforcement } from "@server/jobs/functions/past-due-grace";
import { PAST_DUE_GRACE_DAYS } from "@server/infrastructure/billing/webhook";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

const NOW = new Date("2026-06-15T12:00:00Z");

function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function setAccount(
  accountId: string,
  args: {
    planTier: "free_forever" | "starter" | "growth" | "pro" | "enterprise";
    pastDueSince: Date | null;
  }
): Promise<void> {
  await db
    .update(accountsTable)
    .set({
      planTier: args.planTier,
      pastDueSince: args.pastDueSince,
    })
    .where(eq(accountsTable.id, accountId));
}

async function getPlanTier(accountId: string): Promise<string> {
  const [row] = await db
    .select({ planTier: accountsTable.planTier })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  return row?.planTier ?? "missing";
}

describe("runPastDueGraceEnforcement", () => {
  it("downgrades an account that's been past-due longer than the grace window", async () => {
    await setAccount(ids.accountA.id, {
      planTier: "pro",
      pastDueSince: daysAgo(PAST_DUE_GRACE_DAYS + 1),
    });

    const result = await runPastDueGraceEnforcement(NOW);
    expect(result.downgraded).toContain(ids.accountA.id);
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
  });

  it("does NOT downgrade an account inside the grace window", async () => {
    await setAccount(ids.accountA.id, {
      planTier: "pro",
      pastDueSince: daysAgo(PAST_DUE_GRACE_DAYS - 1),
    });

    const result = await runPastDueGraceEnforcement(NOW);
    expect(result.downgraded).not.toContain(ids.accountA.id);
    expect(await getPlanTier(ids.accountA.id)).toBe("pro");
  });

  it("does NOT downgrade an account at exactly the grace boundary (off-by-one defense)", async () => {
    // pastDueSince = exactly PAST_DUE_GRACE_DAYS ago.
    // The query is `< cutoff` so an equal value should NOT match.
    await setAccount(ids.accountA.id, {
      planTier: "pro",
      pastDueSince: daysAgo(PAST_DUE_GRACE_DAYS),
    });

    const result = await runPastDueGraceEnforcement(NOW);
    expect(result.downgraded).not.toContain(ids.accountA.id);
  });

  it("does NOT touch accounts with pastDueSince=null (paying customers)", async () => {
    await setAccount(ids.accountA.id, {
      planTier: "pro",
      pastDueSince: null,
    });

    const result = await runPastDueGraceEnforcement(NOW);
    expect(result.downgraded.length).toBe(0);
    expect(await getPlanTier(ids.accountA.id)).toBe("pro");
  });

  it("clears pastDueSince after a forced downgrade so the next grace cycle starts fresh", async () => {
    await setAccount(ids.accountA.id, {
      planTier: "pro",
      pastDueSince: daysAgo(PAST_DUE_GRACE_DAYS + 5),
    });

    await runPastDueGraceEnforcement(NOW);

    const [row] = await db
      .select({ pastDueSince: accountsTable.pastDueSince })
      .from(accountsTable)
      .where(eq(accountsTable.id, ids.accountA.id));
    expect(row?.pastDueSince).toBeNull();
  });

  it("doesn't double-downgrade an already-free account", async () => {
    // An account whose tier was previously force-downgraded but kept its
    // pastDueSince set (defensive: shouldn't happen, but the query
    // explicitly excludes free_forever to be safe).
    await setAccount(ids.accountA.id, {
      planTier: "free_forever",
      pastDueSince: daysAgo(PAST_DUE_GRACE_DAYS + 10),
    });

    const result = await runPastDueGraceEnforcement(NOW);
    expect(result.downgraded).not.toContain(ids.accountA.id);
  });

  it("handles multiple eligible accounts in one cron run", async () => {
    await setAccount(ids.accountA.id, {
      planTier: "pro",
      pastDueSince: daysAgo(PAST_DUE_GRACE_DAYS + 1),
    });
    await setAccount(ids.accountB.id, {
      planTier: "growth",
      pastDueSince: daysAgo(PAST_DUE_GRACE_DAYS + 30),
    });

    const result = await runPastDueGraceEnforcement(NOW);
    expect(result.downgraded.length).toBe(2);
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
    expect(await getPlanTier(ids.accountB.id)).toBe("free_forever");
  });
});
