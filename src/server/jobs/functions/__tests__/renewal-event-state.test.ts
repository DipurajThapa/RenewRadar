/**
 * Renewal-event state-machine tests — the cron that promises "we never let
 * a renewal slip past you."
 *
 * Audit gap C1: pre-fix this code was 100% untested. If the boundary math
 * here drifts from the dashboard math, the customer sees "5 days left" on
 * the UI while the cron has already marked the renewal missed — the
 * canonical trust-destroying class of bug.
 *
 * Covers:
 *   - Each transition fires exactly when expected (today is the boundary)
 *   - Idempotency (running twice the same day = no extra work)
 *   - decision != null is respected on the "missed" transition
 *   - A renewal can hop multiple states in one cron run if behind
 *   - Cross-account isolation (cron is global; only the right events move)
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
import { runRenewalStateTransitions } from "@server/jobs/functions/renewal-event-state";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  // The seed creates both accounts' renewals with deadline=today+30,
  // which would trip the cron when we run it. Push B's deadline far out
  // so tests can count A's transitions in isolation. Tests that want
  // cross-account behaviour override this explicitly.
  await db
    .update(renewalEventsTable)
    .set({ noticeDeadline: dayOffset(TODAY, 365) })
    .where(eq(renewalEventsTable.id, ids.accountB.renewalEventId));
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Build a date N days from `anchor` and stringify as YYYY-MM-DD (UTC). */
function dayOffset(anchor: Date, days: number): string {
  const d = new Date(anchor);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}

/**
 * Set the seed-A renewal event's notice_deadline to `daysFromToday` and its
 * status to `status`. Returns the updated row.
 */
async function setRenewal(
  accountId: string,
  renewalEventId: string,
  args: {
    today: Date;
    daysFromToday: number;
    status:
      | "upcoming"
      | "notice_window"
      | "action_needed"
      | "missed"
      | "processed";
    decision?: string | null;
  }
): Promise<void> {
  await db
    .update(renewalEventsTable)
    .set({
      noticeDeadline: dayOffset(args.today, args.daysFromToday),
      status: args.status,
      decision: (args.decision ?? null) as never,
    })
    .where(eq(renewalEventsTable.id, renewalEventId));
}

async function getStatus(renewalEventId: string): Promise<string> {
  const [row] = await db
    .select({ status: renewalEventsTable.status })
    .from(renewalEventsTable)
    .where(eq(renewalEventsTable.id, renewalEventId));
  return row?.status ?? "missing";
}

// Stable anchor for "today" so the test math is local-deterministic.
const TODAY = new Date("2026-06-15T12:00:00Z");

// ─────────────────────────────────────────────────────────────────────────
// upcoming → notice_window (deadline within 30 days)
// ─────────────────────────────────────────────────────────────────────────

describe("upcoming → notice_window", () => {
  it("fires when deadline is exactly 30 days out", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: 30,
      status: "upcoming",
    });
    const result = await runRenewalStateTransitions(TODAY);
    expect(result.toNoticeWindow).toBe(1);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe(
      "notice_window"
    );
  });

  it("fires when deadline is inside the window (5 days out)", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: 5,
      status: "upcoming",
    });
    // Will hop notice_window AND action_needed in the same run.
    await runRenewalStateTransitions(TODAY);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe(
      "action_needed"
    );
  });

  it("does NOT fire when deadline is 31 days out", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: 31,
      status: "upcoming",
    });
    const result = await runRenewalStateTransitions(TODAY);
    expect(result.toNoticeWindow).toBe(0);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe("upcoming");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// notice_window → action_needed (deadline within 7 days)
// ─────────────────────────────────────────────────────────────────────────

describe("notice_window → action_needed", () => {
  it("fires when deadline is exactly 7 days out", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: 7,
      status: "notice_window",
    });
    await runRenewalStateTransitions(TODAY);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe(
      "action_needed"
    );
  });

  it("does NOT fire when deadline is 8 days out", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: 8,
      status: "notice_window",
    });
    const result = await runRenewalStateTransitions(TODAY);
    expect(result.toActionNeeded).toBe(0);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe(
      "notice_window"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// action_needed → missed (deadline has passed AND no decision)
// ─────────────────────────────────────────────────────────────────────────

describe("action_needed → missed", () => {
  it("fires when deadline was yesterday and no decision", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: -1,
      status: "action_needed",
      decision: null,
    });
    const result = await runRenewalStateTransitions(TODAY);
    expect(result.toMissed).toBe(1);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe("missed");
  });

  it("does NOT fire when deadline is exactly today", async () => {
    // Today is still the LAST day to act — not yet missed. The query is
    // `deadline < today`, so a deadline equal to today stays put.
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: 0,
      status: "action_needed",
      decision: null,
    });
    const result = await runRenewalStateTransitions(TODAY);
    expect(result.toMissed).toBe(0);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe(
      "action_needed"
    );
  });

  it("does NOT fire when decision is set (even past deadline)", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: -7, // a week overdue
      status: "action_needed",
      decision: "renewed",
    });
    const result = await runRenewalStateTransitions(TODAY);
    expect(result.toMissed).toBe(0);
    // The status stays action_needed because the missed-transition was
    // suppressed. The next operator will handle it manually (e.g., move
    // to processed via the decide-now flow).
    expect(await getStatus(ids.accountA.renewalEventId)).toBe(
      "action_needed"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────

describe("idempotency", () => {
  it("running twice the same day is a no-op the second time", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: 5,
      status: "upcoming",
    });
    const first = await runRenewalStateTransitions(TODAY);
    expect(first.toNoticeWindow + first.toActionNeeded).toBeGreaterThan(0);
    const second = await runRenewalStateTransitions(TODAY);
    expect(second).toEqual({
      toNoticeWindow: 0,
      toActionNeeded: 0,
      toMissed: 0,
    });
    expect(await getStatus(ids.accountA.renewalEventId)).toBe(
      "action_needed"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Multi-hop in one run (upcoming → notice_window → action_needed)
// ─────────────────────────────────────────────────────────────────────────

describe("multi-hop in a single run", () => {
  it("upcoming with deadline 5 days out hops to action_needed in one run", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: 5,
      status: "upcoming",
    });
    const result = await runRenewalStateTransitions(TODAY);
    expect(result.toNoticeWindow).toBe(1);
    expect(result.toActionNeeded).toBe(1);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe(
      "action_needed"
    );
  });

  it("upcoming with deadline yesterday hops all the way to missed in one run", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: -1,
      status: "upcoming",
      decision: null,
    });
    const result = await runRenewalStateTransitions(TODAY);
    expect(result.toNoticeWindow).toBe(1);
    expect(result.toActionNeeded).toBe(1);
    expect(result.toMissed).toBe(1);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe("missed");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cross-account isolation
// ─────────────────────────────────────────────────────────────────────────

describe("cross-account isolation", () => {
  it("only events matching the date criteria move, regardless of account", async () => {
    // A: should move from action_needed → missed
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: -2,
      status: "action_needed",
      decision: null,
    });
    // B: should stay upcoming (60 days out)
    await setRenewal(ids.accountB.id, ids.accountB.renewalEventId, {
      today: TODAY,
      daysFromToday: 60,
      status: "upcoming",
      decision: null,
    });

    await runRenewalStateTransitions(TODAY);

    expect(await getStatus(ids.accountA.renewalEventId)).toBe("missed");
    expect(await getStatus(ids.accountB.renewalEventId)).toBe("upcoming");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// processed events stay put (decision was already logged)
// ─────────────────────────────────────────────────────────────────────────

describe("processed events", () => {
  it("a processed event never transitions back to missed", async () => {
    await setRenewal(ids.accountA.id, ids.accountA.renewalEventId, {
      today: TODAY,
      daysFromToday: -30,
      status: "processed",
      decision: "cancelled",
    });
    await runRenewalStateTransitions(TODAY);
    expect(await getStatus(ids.accountA.renewalEventId)).toBe("processed");
  });
});
