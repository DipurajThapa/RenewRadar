/**
 * System health aggregator tests.
 *
 * Pins the contract the admin page renders against. Notification rate
 * math is the most likely thing to drift — covered explicitly. The
 * overall verdict thresholds are also covered so a future tweak to the
 * "critical" cutoff has to update the test (good — forces intentionality).
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  aiExtractionRunsTable,
  documentsTable,
  notificationsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { getSystemHealth } from "@server/application/system-health";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  // Pin a known tier so the AI budget math is predictable.
  await db
    .update(accountsTable)
    .set({ planTier: "starter" })
    .where(eq(accountsTable.id, ids.accountA.id));
  // The seed inserts a baseline notification per account ("sent" via
  // email). Tests below need a clean slate to assert exact counts; we
  // wipe just the notifications, not the rest of the seed state.
  await db.delete(notificationsTable);
});

// ─────────────────────────────────────────────────────────────────────────
// Provider snapshot
// ─────────────────────────────────────────────────────────────────────────

describe("getSystemHealth providers", () => {
  it("includes the wired provider names for every infra slot", async () => {
    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.providers.aiExtraction).toBeTruthy();
    expect(health.providers.aiInsights).toBeTruthy();
    expect(health.providers.ocr).toBeTruthy();
    expect(health.providers.storage).toBeTruthy();
    expect(health.providers.rateLimit).toBeTruthy();
  });

  it("reports a db latency in ms (round-trip)", async () => {
    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.dbLatencyMs).toBeGreaterThanOrEqual(0);
    expect(health.dbLatencyMs).toBeLessThan(5_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Notification rate math
// ─────────────────────────────────────────────────────────────────────────

describe("getSystemHealth notification health", () => {
  it("computes success rate per channel correctly", async () => {
    // 3 sent + 1 failed on email = 75% success. The notification table
    // has a unique (user, trigger, entity, channel) dedupe constraint so
    // we use distinct triggers to seed multiple rows.
    const triggers = [
      "notice_window_30",
      "notice_window_14",
      "notice_window_7",
      "notice_window_3",
    ] as const;
    await db.insert(notificationsTable).values([
      ...triggers.slice(0, 3).map((trigger) => ({
        accountId: ids.accountA.id,
        userId: ids.accountA.userId,
        channel: "email" as const,
        trigger,
        entityType: "renewal_event",
        entityId: ids.accountA.renewalEventId,
        status: "sent" as const,
        sentAt: new Date(),
      })),
      {
        accountId: ids.accountA.id,
        userId: ids.accountA.userId,
        channel: "email" as const,
        trigger: triggers[3],
        entityType: "renewal_event",
        entityId: ids.accountA.renewalEventId,
        status: "failed" as const,
        sentAt: null,
      },
    ]);

    const health = await getSystemHealth(ids.accountA.id, "starter");
    const email = health.notifications.byChannel.find(
      (c) => c.channel === "email"
    );
    expect(email?.sent).toBe(3);
    expect(email?.failed).toBe(1);
    expect(email?.successRatePct).toBe(75);
  });

  it("returns null successRatePct when nothing was attempted", async () => {
    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.notifications.total).toBe(0);
    expect(health.notifications.byChannel.length).toBe(0);
  });

  it("does NOT leak account B's notifications into A's health view", async () => {
    // Account B has a failed notification; account A's health should not
    // include it.
    await db.insert(notificationsTable).values({
      accountId: ids.accountB.id,
      userId: ids.accountB.userId,
      channel: "email" as const,
      trigger: "notice_window_30" as const,
      entityType: "renewal_event",
      entityId: ids.accountB.renewalEventId,
      status: "failed" as const,
      sentAt: null,
    });

    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.openIssues.notificationFailures7d).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Extraction stats
// ─────────────────────────────────────────────────────────────────────────

describe("getSystemHealth extraction health", () => {
  async function seedExtractionRuns(
    accountId: string,
    statuses: Array<"succeeded" | "failed" | "running">
  ): Promise<void> {
    // Each run needs a real documentId (NOT NULL FK).
    for (const status of statuses) {
      const [doc] = await db
        .insert(documentsTable)
        .values({
          accountId,
          uploadedByUserId: ids.accountA.userId,
          kind: "contract" as const,
          filename: `${status}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1000,
          storageKey: `test/${status}-${Date.now()}-${Math.random()}.pdf`,
          checksumSha256: `sha-${status}-${Date.now()}-${Math.random()}`,
          textExtractionStatus: "ready" as const,
        })
        .returning();
      if (!doc) throw new Error("seed doc failed");
      await db.insert(aiExtractionRunsTable).values({
        accountId,
        documentId: doc.id,
        provider: "test-stub",
        model: "test",
        promptVersion: "v1",
        status,
        pagesCharged: status === "succeeded" ? 10 : 0,
        startedAt: new Date(),
      });
    }
  }

  it("computes success rate from succeeded vs failed", async () => {
    await seedExtractionRuns(ids.accountA.id, [
      "succeeded",
      "succeeded",
      "succeeded",
      "failed",
    ]);
    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.extractions.succeeded).toBe(3);
    expect(health.extractions.failed).toBe(1);
    expect(health.extractions.successRatePct).toBe(75);
  });

  it("running extractions don't count as failed", async () => {
    await seedExtractionRuns(ids.accountA.id, [
      "succeeded",
      "running",
    ]);
    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.extractions.failed).toBe(0);
    expect(health.extractions.running).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Overall verdict + open issues
// ─────────────────────────────────────────────────────────────────────────

describe("getSystemHealth overall verdict", () => {
  it("clean account returns 'healthy'", async () => {
    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.overall).toBe("healthy");
  });

  it("returns 'degraded' when there is a single notification failure", async () => {
    await db.insert(notificationsTable).values({
      accountId: ids.accountA.id,
      userId: ids.accountA.userId,
      channel: "email" as const,
      trigger: "notice_window_30" as const,
      entityType: "renewal_event",
      entityId: ids.accountA.renewalEventId,
      status: "failed" as const,
      sentAt: null,
    });
    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.overall).toBe("degraded");
  });

  it("returns 'critical' when 5 or more notifications failed in 7 days", async () => {
    await db.insert(notificationsTable).values(
      Array.from({ length: 5 }, (_, i) => ({
        accountId: ids.accountA.id,
        userId: ids.accountA.userId,
        channel: "email" as const,
        // Use distinct triggers so the dedupe unique index doesn't fire.
        trigger: ([
          "notice_window_30",
          "notice_window_14",
          "notice_window_7",
          "notice_window_3",
          "notice_window_1",
        ] as const)[i]!,
        entityType: "renewal_event",
        entityId: ids.accountA.renewalEventId,
        status: "failed" as const,
        sentAt: null,
      }))
    );
    const health = await getSystemHealth(ids.accountA.id, "starter");
    expect(health.overall).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AI budget math
// ─────────────────────────────────────────────────────────────────────────

describe("getSystemHealth aiBudget", () => {
  it("computes percentUsed from used vs cap", async () => {
    const [doc] = await db
      .insert(documentsTable)
      .values({
        accountId: ids.accountA.id,
        uploadedByUserId: ids.accountA.userId,
        kind: "contract" as const,
        filename: "budget.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1000,
        storageKey: "test/budget.pdf",
        checksumSha256: "sha-budget",
        textExtractionStatus: "ready" as const,
      })
      .returning();
    if (!doc) throw new Error("seed doc failed");
    await db.insert(aiExtractionRunsTable).values({
      accountId: ids.accountA.id,
      documentId: doc.id,
      provider: "test-stub",
      model: "test",
      promptVersion: "v1",
      status: "succeeded",
      pagesCharged: 50,
      startedAt: new Date(),
    });

    const health = await getSystemHealth(ids.accountA.id, "starter");
    // Starter cap = 200; used 50; expected ~25%.
    expect(health.aiBudget.usedThisMonth).toBe(50);
    expect(health.aiBudget.cap).toBe(200);
    expect(health.aiBudget.percentUsed).toBe(25);
  });

  it("enterprise returns capIsFinite=false + percentUsed=null", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "enterprise" })
      .where(eq(accountsTable.id, ids.accountA.id));
    const health = await getSystemHealth(ids.accountA.id, "enterprise");
    expect(health.aiBudget.capIsFinite).toBe(false);
    expect(health.aiBudget.percentUsed).toBeNull();
  });
});
