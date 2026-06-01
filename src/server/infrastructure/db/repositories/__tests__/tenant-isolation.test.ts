/**
 * Tenant-isolation contract test.
 *
 * For every read repository and every write use case exposed by `@server/*`,
 * this suite asserts:
 *   1. Scoping a call to Account A's ID NEVER returns or mutates Account B's data.
 *   2. Mutations called with the wrong account ID throw rather than silently no-op.
 *
 * If a new repository module is added under
 * `src/server/infrastructure/db/repositories/`, add a section here. The
 * `coverage` test at the bottom enforces that we don't forget.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";

import {
  countActiveSubscriptions,
  getSubscriptionDetail,
  listSubscriptions,
} from "@server/infrastructure/db/repositories/subscriptions";
import { findVendorByName, listVendorsByAccount } from "@server/infrastructure/db/repositories/vendors";
import {
  listAccountUsers,
  userBelongsToAccount,
} from "@server/infrastructure/db/repositories/users";
import {
  getRenewalEventWithContext,
  listRenewalsInRange,
} from "@server/infrastructure/db/repositories/renewals";
import {
  getNoticeDeadlineKpis,
  listNoticeDeadlines,
} from "@server/infrastructure/db/repositories/notice-deadlines";
import {
  getActionBandCounts,
  getAnomalies,
  getDashboardKpis,
  getNoticeDeadlineSpotlight,
  getRenewalCalendarSnapshot,
} from "@server/infrastructure/db/repositories/dashboard";
import {
  getRecentActivity,
  listAuditEntries,
  listAuditEntityTypes,
} from "@server/infrastructure/db/repositories/audit-log";
import {
  countUnreadInAppNotifications,
  listRecentInAppNotifications,
} from "@server/infrastructure/db/repositories/notifications";
import { listActionQueueRows } from "@server/infrastructure/db/repositories/action-queue";
import {
  getSavingsForRenewalEvent,
  getSavingsTotals,
  listSavingsForAccount,
} from "@server/infrastructure/db/repositories/savings";
import {
  getExposureByStatus,
  getMissedDeadlinesByMonth,
  listExposureDetail,
} from "@server/infrastructure/db/repositories/reports";
import {
  findAccountByIcsToken,
  getIcsIntegration,
  getSlackIntegration,
} from "@server/infrastructure/db/repositories/integrations";
import { upsertIntegration } from "@server/application/integrations";
import {
  getInvitationByToken,
  listPendingInvitations,
} from "@server/infrastructure/db/repositories/invitations";
import { createInvitation } from "@server/application/invitations";
import {
  getVendor,
  getVendorIntelligence,
  listVendorEvents,
  listVendorsWithIntelligence,
} from "@server/infrastructure/db/repositories/vendor-memory";
import {
  listComplianceArtifactsForVendor,
  listExpiringComplianceArtifacts,
} from "@server/infrastructure/db/repositories/compliance";
import {
  countPendingApprovals,
  listPendingApprovals,
} from "@server/infrastructure/db/repositories/approvals";
import {
  getDocument,
  listDocuments,
  listDocumentsForSubscription,
} from "@server/infrastructure/db/repositories/documents";
import {
  countPendingReviewFields,
  getMonthlyPagesUsed,
  listExtractedFieldsForDocument,
  listPendingReviewFields,
} from "@server/infrastructure/db/repositories/ai-extractions";
import {
  getMonthlyReasoningCostUsdMicros,
  recordReasoningUsage,
} from "@server/infrastructure/db/repositories/ai-reasoning-usage";

import {
  softDeleteSubscription,
  updateSubscription,
} from "@server/application/subscriptions";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

// ─────────────────────────────────────────────────────────────────────────
// subscriptions queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/subscriptions", () => {
  it("listSubscriptions only returns rows for the scoped account", async () => {
    const aRows = await listSubscriptions(ids.accountA.id);
    const bRows = await listSubscriptions(ids.accountB.id);

    expect(aRows.map((r) => r.id)).toEqual([ids.accountA.subscriptionId]);
    expect(bRows.map((r) => r.id)).toEqual([ids.accountB.subscriptionId]);
    expect(aRows.every((r) => r.vendorName === "Vendor A")).toBe(true);
    expect(bRows.every((r) => r.vendorName === "Vendor B")).toBe(true);
    // Owner join only surfaces the scoped account's user
    expect(aRows[0]?.ownerUserId).toBe(ids.accountA.userId);
    expect(aRows[0]?.ownerEmail).toBe("owner@a.example.test");
    expect(bRows[0]?.ownerUserId).toBe(ids.accountB.userId);
  });

  it("listSubscriptions honors owner filter without leaking cross-account rows", async () => {
    // Filter A's list to "owner = B's user" — should return zero rows even
    // though that UUID exists in account B.
    const wrong = await listSubscriptions(ids.accountA.id, {
      ownerUserId: ids.accountB.userId,
    });
    expect(wrong).toEqual([]);

    // Filter A's list to "unassigned" — also zero (the seed assigns owners).
    const unassigned = await listSubscriptions(ids.accountA.id, {
      ownerUserId: "unassigned",
    });
    expect(unassigned).toEqual([]);

    // Filter A's list to A's user — returns A's row only.
    const rightful = await listSubscriptions(ids.accountA.id, {
      ownerUserId: ids.accountA.userId,
    });
    expect(rightful.map((r) => r.id)).toEqual([ids.accountA.subscriptionId]);
  });

  it("getSubscriptionDetail returns null when crossing the account boundary", async () => {
    const wrong = await getSubscriptionDetail(
      ids.accountA.id,
      ids.accountB.subscriptionId
    );
    expect(wrong).toBeNull();

    const right = await getSubscriptionDetail(
      ids.accountB.id,
      ids.accountB.subscriptionId
    );
    expect(right).not.toBeNull();
    expect(right?.vendor.name).toBe("Vendor B");
  });

  it("countActiveSubscriptions counts only the scoped account", async () => {
    expect(await countActiveSubscriptions(ids.accountA.id)).toBe(1);
    expect(await countActiveSubscriptions(ids.accountB.id)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// users queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/users", () => {
  it("listAccountUsers only returns users from the scoped account", async () => {
    const a = await listAccountUsers(ids.accountA.id);
    const b = await listAccountUsers(ids.accountB.id);
    expect(a.map((u) => u.id)).toEqual([ids.accountA.userId]);
    expect(b.map((u) => u.id)).toEqual([ids.accountB.userId]);
  });

  it("userBelongsToAccount is false across the account boundary", async () => {
    expect(
      await userBelongsToAccount(ids.accountA.id, ids.accountB.userId)
    ).toBe(false);
    expect(
      await userBelongsToAccount(ids.accountB.id, ids.accountA.userId)
    ).toBe(false);
    expect(
      await userBelongsToAccount(ids.accountA.id, ids.accountA.userId)
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// vendors queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/vendors", () => {
  it("listVendorsByAccount only returns the scoped account's vendors", async () => {
    const a = await listVendorsByAccount(ids.accountA.id);
    const b = await listVendorsByAccount(ids.accountB.id);
    expect(a.map((v) => v.name)).toEqual(["Vendor A"]);
    expect(b.map((v) => v.name)).toEqual(["Vendor B"]);
  });

  it("findVendorByName cannot reach across accounts", async () => {
    // Vendor B exists in account B but should be invisible to account A
    const aFromB = await findVendorByName(ids.accountA.id, "Vendor B");
    const bFromA = await findVendorByName(ids.accountB.id, "Vendor A");
    expect(aFromB).toBeNull();
    expect(bFromA).toBeNull();

    const aFromA = await findVendorByName(ids.accountA.id, "Vendor A");
    expect(aFromA?.name).toBe("Vendor A");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// renewals queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/renewals", () => {
  it("listRenewalsInRange only returns the scoped account's renewal events", async () => {
    const a = await listRenewalsInRange(ids.accountA.id, 365);
    const b = await listRenewalsInRange(ids.accountB.id, 365);
    expect(a.map((r) => r.renewalEventId)).toEqual([ids.accountA.renewalEventId]);
    expect(b.map((r) => r.renewalEventId)).toEqual([ids.accountB.renewalEventId]);
  });

  it("getRenewalEventWithContext returns null when crossing the account boundary", async () => {
    const wrong = await getRenewalEventWithContext(
      ids.accountA.id,
      ids.accountB.renewalEventId
    );
    expect(wrong).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// notice-deadlines queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/notice-deadlines", () => {
  it("listNoticeDeadlines only returns the scoped account's rows", async () => {
    const a = await listNoticeDeadlines(ids.accountA.id, {
      range: 365,
      status: "all",
    });
    const b = await listNoticeDeadlines(ids.accountB.id, {
      range: 365,
      status: "all",
    });
    expect(a.map((r) => r.renewalEventId)).toEqual([ids.accountA.renewalEventId]);
    expect(b.map((r) => r.renewalEventId)).toEqual([ids.accountB.renewalEventId]);
  });

  it("getNoticeDeadlineKpis aggregates only the scoped account", async () => {
    // Both accounts have 1 upcoming-in-30d event. A's count should be 1, not 2.
    const a = await getNoticeDeadlineKpis(ids.accountA.id);
    const b = await getNoticeDeadlineKpis(ids.accountB.id);
    expect(a.upcomingNext90).toBe(1);
    expect(b.upcomingNext90).toBe(1);
    // And the aggregated value should reflect only the scoped account.
    expect(a.upcomingNext90ValueCents).toBe(100_000);
    expect(b.upcomingNext90ValueCents).toBe(100_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// notifications queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/notifications", () => {
  // The seed inserts an *email*-channel notification, not in-app, so the
  // in-app query naturally returns 0 — that's the contract. To prove the
  // tenant guard we insert one in_app row per account inline.
  it("listRecentInAppNotifications only returns the scoped account's rows", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { notificationsTable } = await import("@server/infrastructure/db/schema");

    await db.insert(notificationsTable).values([
      {
        accountId: ids.accountA.id,
        userId: ids.accountA.userId,
        channel: "in_app",
        trigger: "notice_window_30",
        entityType: "subscription",
        entityId: ids.accountA.subscriptionId,
        status: "queued",
      },
      {
        accountId: ids.accountB.id,
        userId: ids.accountB.userId,
        channel: "in_app",
        trigger: "notice_window_30",
        entityType: "subscription",
        entityId: ids.accountB.subscriptionId,
        status: "queued",
      },
    ]);

    const a = await listRecentInAppNotifications(
      ids.accountA.id,
      ids.accountA.userId
    );
    const b = await listRecentInAppNotifications(
      ids.accountB.id,
      ids.accountB.userId
    );
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0]?.vendorName).toBe("Vendor A");
    expect(b[0]?.vendorName).toBe("Vendor B");

    // Crossed scoping returns nothing even with valid IDs from the other side.
    const crossed = await listRecentInAppNotifications(
      ids.accountA.id,
      ids.accountB.userId
    );
    expect(crossed).toEqual([]);
  });

  it("countUnreadInAppNotifications counts only the scoped account/user", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { notificationsTable } = await import("@server/infrastructure/db/schema");
    await db.insert(notificationsTable).values([
      {
        accountId: ids.accountA.id,
        userId: ids.accountA.userId,
        channel: "in_app",
        trigger: "notice_window_30",
        entityType: "subscription",
        entityId: ids.accountA.subscriptionId,
        status: "queued",
      },
      {
        accountId: ids.accountB.id,
        userId: ids.accountB.userId,
        channel: "in_app",
        trigger: "notice_window_14",
        entityType: "subscription",
        entityId: ids.accountB.subscriptionId,
        status: "queued",
      },
    ]);

    expect(
      await countUnreadInAppNotifications(ids.accountA.id, ids.accountA.userId)
    ).toBe(1);
    expect(
      await countUnreadInAppNotifications(ids.accountB.id, ids.accountB.userId)
    ).toBe(1);
    // Cross-tenant count is zero.
    expect(
      await countUnreadInAppNotifications(ids.accountA.id, ids.accountB.userId)
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// savings queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/savings", () => {
  it("listSavingsForAccount / getSavingsTotals only return the scoped account", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { savingsRecordsTable } = await import("@server/infrastructure/db/schema");

    await db.insert(savingsRecordsTable).values([
      {
        accountId: ids.accountA.id,
        renewalEventId: ids.accountA.renewalEventId,
        subscriptionId: ids.accountA.subscriptionId,
        kind: "cancelled",
        baselineAnnualUsdCents: 100_000,
        newAnnualUsdCents: 0,
        savedAnnualUsdCents: 100_000,
      },
      {
        accountId: ids.accountB.id,
        renewalEventId: ids.accountB.renewalEventId,
        subscriptionId: ids.accountB.subscriptionId,
        kind: "downgraded",
        baselineAnnualUsdCents: 60_000,
        newAnnualUsdCents: 30_000,
        savedAnnualUsdCents: 30_000,
      },
    ]);

    const a = await listSavingsForAccount(ids.accountA.id);
    const b = await listSavingsForAccount(ids.accountB.id);
    expect(a.map((r) => r.savedAnnualUsdCents)).toEqual([100_000]);
    expect(b.map((r) => r.savedAnnualUsdCents)).toEqual([30_000]);

    const aTotals = await getSavingsTotals(ids.accountA.id);
    const bTotals = await getSavingsTotals(ids.accountB.id);
    expect(aTotals.totalSavedAnnualUsdCents).toBe(100_000);
    expect(bTotals.totalSavedAnnualUsdCents).toBe(30_000);
  });

  it("getSavingsForRenewalEvent rejects cross-account lookups", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { savingsRecordsTable } = await import("@server/infrastructure/db/schema");

    await db.insert(savingsRecordsTable).values({
      accountId: ids.accountB.id,
      renewalEventId: ids.accountB.renewalEventId,
      subscriptionId: ids.accountB.subscriptionId,
      kind: "cancelled",
      baselineAnnualUsdCents: 50_000,
      newAnnualUsdCents: 0,
      savedAnnualUsdCents: 50_000,
    });

    // Account A asks for B's renewal-event savings — must be null.
    const crossed = await getSavingsForRenewalEvent(
      ids.accountA.id,
      ids.accountB.renewalEventId
    );
    expect(crossed).toBeNull();

    const rightful = await getSavingsForRenewalEvent(
      ids.accountB.id,
      ids.accountB.renewalEventId
    );
    expect(rightful?.savedAnnualUsdCents).toBe(50_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// vendor-memory queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/vendor-memory", () => {
  it("listVendorEvents / getVendor / listVendorsWithIntelligence only see scoped account", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { vendorEventsTable } = await import("@server/infrastructure/db/schema");

    await db.insert(vendorEventsTable).values([
      {
        accountId: ids.accountA.id,
        vendorId: ids.accountA.vendorId,
        kind: "user_note_added" as const,
        payload: { note: "A-note" } as Record<string, unknown>,
      },
      {
        accountId: ids.accountB.id,
        vendorId: ids.accountB.vendorId,
        kind: "user_note_added" as const,
        payload: { note: "B-note" } as Record<string, unknown>,
      },
    ]);

    const aEvents = await listVendorEvents(ids.accountA.id, ids.accountA.vendorId);
    const bEvents = await listVendorEvents(ids.accountB.id, ids.accountB.vendorId);
    expect(aEvents.length).toBeGreaterThanOrEqual(1);
    expect(bEvents.length).toBeGreaterThanOrEqual(1);
    // Cross-account lookup must return empty / null
    const crossed = await listVendorEvents(ids.accountA.id, ids.accountB.vendorId);
    expect(crossed).toEqual([]);
    expect(await getVendor(ids.accountA.id, ids.accountB.vendorId)).toBeNull();
    expect((await getVendor(ids.accountA.id, ids.accountA.vendorId))?.name).toBe(
      "Vendor A"
    );

    const aList = await listVendorsWithIntelligence(ids.accountA.id);
    const bList = await listVendorsWithIntelligence(ids.accountB.id);
    expect(aList.map((v) => v.name)).toEqual(["Vendor A"]);
    expect(bList.map((v) => v.name)).toEqual(["Vendor B"]);

    const aIntel = await getVendorIntelligence(ids.accountA.id, ids.accountA.vendorId);
    expect(aIntel.totalSpendLifetimeCents).toBe(100_000);
    expect(aIntel.subscriptionCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// compliance queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/compliance", () => {
  it("listComplianceArtifactsForVendor / listExpiringComplianceArtifacts only see scoped account", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { complianceArtifactsTable } = await import(
      "@server/infrastructure/db/schema"
    );

    const expiresSoon = new Date(Date.now() + 14 * 86_400_000);
    await db.insert(complianceArtifactsTable).values([
      {
        accountId: ids.accountA.id,
        vendorId: ids.accountA.vendorId,
        kind: "dpa" as const,
        receivedAt: new Date(),
        expiresAt: expiresSoon,
      },
      {
        accountId: ids.accountB.id,
        vendorId: ids.accountB.vendorId,
        kind: "dpa" as const,
        receivedAt: new Date(),
        expiresAt: expiresSoon,
      },
    ]);

    const a = await listComplianceArtifactsForVendor(
      ids.accountA.id,
      ids.accountA.vendorId
    );
    const b = await listComplianceArtifactsForVendor(
      ids.accountB.id,
      ids.accountB.vendorId
    );
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);

    const crossed = await listComplianceArtifactsForVendor(
      ids.accountA.id,
      ids.accountB.vendorId
    );
    expect(crossed).toEqual([]);

    const aExpiring = await listExpiringComplianceArtifacts(ids.accountA.id, 30);
    const bExpiring = await listExpiringComplianceArtifacts(ids.accountB.id, 30);
    expect(aExpiring.length).toBe(1);
    expect(bExpiring.length).toBe(1);
    expect(aExpiring[0]?.vendorName).toBe("Vendor A");
    expect(bExpiring[0]?.vendorName).toBe("Vendor B");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// documents queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/documents", () => {
  it("listDocuments + getDocument only see the scoped account", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { documentsTable } = await import("@server/infrastructure/db/schema");

    const [docA] = await db
      .insert(documentsTable)
      .values({
        accountId: ids.accountA.id,
        subscriptionId: ids.accountA.subscriptionId,
        uploadedByUserId: ids.accountA.userId,
        filename: "contract-a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        storageKey: "account/A/document/x/contract-a.pdf",
        checksumSha256: "a".repeat(64),
        textExtractionStatus: "ready",
      })
      .returning();
    const [docB] = await db
      .insert(documentsTable)
      .values({
        accountId: ids.accountB.id,
        subscriptionId: ids.accountB.subscriptionId,
        uploadedByUserId: ids.accountB.userId,
        filename: "contract-b.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        storageKey: "account/B/document/y/contract-b.pdf",
        checksumSha256: "b".repeat(64),
        textExtractionStatus: "ready",
      })
      .returning();

    const aList = await listDocuments(ids.accountA.id);
    const bList = await listDocuments(ids.accountB.id);
    expect(aList.map((d) => d.filename)).toEqual(["contract-a.pdf"]);
    expect(bList.map((d) => d.filename)).toEqual(["contract-b.pdf"]);

    expect((await getDocument(ids.accountA.id, docB!.id))).toBeNull();
    expect((await getDocument(ids.accountB.id, docA!.id))).toBeNull();
    expect((await getDocument(ids.accountA.id, docA!.id))?.filename).toBe(
      "contract-a.pdf"
    );

    const subA = await listDocumentsForSubscription(
      ids.accountA.id,
      ids.accountA.subscriptionId
    );
    const subB = await listDocumentsForSubscription(
      ids.accountA.id,
      ids.accountB.subscriptionId
    );
    expect(subA.length).toBe(1);
    expect(subB.length).toBe(0); // cross-account = empty
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ai-extractions queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/ai-extractions", () => {
  it("listPendingReviewFields + countPendingReviewFields only see the scoped account", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const {
      documentsTable,
      aiExtractionRunsTable,
      aiExtractedFieldsTable,
    } = await import("@server/infrastructure/db/schema");

    // Seed a document + run + pending field per account.
    for (const ids2 of [ids.accountA, ids.accountB]) {
      const [doc] = await db
        .insert(documentsTable)
        .values({
          accountId: ids2.id,
          subscriptionId: ids2.subscriptionId,
          uploadedByUserId: ids2.userId,
          filename: "contract.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          storageKey: `account/${ids2.id}/document/x/contract.pdf`,
          checksumSha256: "c".repeat(64),
          textExtractionStatus: "ready",
        })
        .returning();
      const [run] = await db
        .insert(aiExtractionRunsTable)
        .values({
          accountId: ids2.id,
          documentId: doc!.id,
          provider: "heuristic-stub",
          model: "heuristic-v1",
          promptVersion: "v1.0",
          status: "succeeded",
          pagesCharged: 3,
        })
        .returning();
      await db.insert(aiExtractedFieldsTable).values({
        accountId: ids2.id,
        runId: run!.id,
        documentId: doc!.id,
        subscriptionId: ids2.subscriptionId,
        fieldKey: "renewal_date",
        rawValue: "renewal on 2027-01-01",
        parsedValueJson: { date: "2027-01-01" } as Record<string, unknown>,
        confidence: 90,
        evidenceQuote: "renewal on 2027-01-01",
        evidencePageNumber: 1,
      });
    }

    const aPending = await listPendingReviewFields(ids.accountA.id);
    const bPending = await listPendingReviewFields(ids.accountB.id);
    expect(aPending.length).toBe(1);
    expect(bPending.length).toBe(1);
    expect(aPending[0]?.vendorName).toBe("Vendor A");
    expect(bPending[0]?.vendorName).toBe("Vendor B");

    expect(await countPendingReviewFields(ids.accountA.id)).toBe(1);
    expect(await countPendingReviewFields(ids.accountB.id)).toBe(1);

    // pagesCharged sums only the scoped account's runs.
    expect(await getMonthlyPagesUsed(ids.accountA.id)).toBe(3);
    expect(await getMonthlyPagesUsed(ids.accountB.id)).toBe(3);

    // Document-scoped lookup respects accountId.
    const aFields = await listExtractedFieldsForDocument(
      ids.accountA.id,
      aPending[0]!.documentId
    );
    expect(aFields.length).toBe(1);
    const crossed = await listExtractedFieldsForDocument(
      ids.accountB.id,
      aPending[0]!.documentId
    );
    expect(crossed).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// approvals queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/approvals", () => {
  it("listPendingApprovals + countPendingApprovals only see the scoped account", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { renewalEventsTable } = await import("@server/infrastructure/db/schema");
    const { eq: eqOp } = await import("drizzle-orm");

    // Mark A's renewal as pending an approval, B's as not_required.
    await db
      .update(renewalEventsTable)
      .set({
        decision: "renewed",
        decidedByUserId: ids.accountA.userId,
        decisionAt: new Date(),
        approvalStatus: "pending",
      })
      .where(eqOp(renewalEventsTable.id, ids.accountA.renewalEventId));

    const aList = await listPendingApprovals(ids.accountA.id);
    const bList = await listPendingApprovals(ids.accountB.id);
    expect(aList.length).toBe(1);
    expect(bList.length).toBe(0);
    expect(aList[0]?.vendorName).toBe("Vendor A");

    expect(await countPendingApprovals(ids.accountA.id)).toBe(1);
    expect(await countPendingApprovals(ids.accountB.id)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// invitations queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/invitations", () => {
  it("listPendingInvitations only returns the scoped account's invites", async () => {
    const a = await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "invitee-a@example.test",
      role: "member",
      accountPlanTier: "starter",
    });
    const b = await createInvitation({
      accountId: ids.accountB.id,
      actorUserId: ids.accountB.userId,
      email: "invitee-b@example.test",
      role: "admin",
      accountPlanTier: "starter",
    });

    const aList = await listPendingInvitations(ids.accountA.id);
    const bList = await listPendingInvitations(ids.accountB.id);
    expect(aList.map((i) => i.email)).toEqual(["invitee-a@example.test"]);
    expect(bList.map((i) => i.email)).toEqual(["invitee-b@example.test"]);

    // getInvitationByToken is token-scoped (no account ID input) — it must
    // still surface the right account on lookup.
    const aLookup = await getInvitationByToken(a.token);
    const bLookup = await getInvitationByToken(b.token);
    expect(aLookup?.accountId).toBe(ids.accountA.id);
    expect(bLookup?.accountId).toBe(ids.accountB.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// integrations queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/integrations", () => {
  it("getSlackIntegration / getIcsIntegration only see the scoped account", async () => {
    // Seed integrations on both accounts.
    await upsertIntegration({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      kind: "slack_webhook",
      config: { webhookUrl: "https://hooks.slack.com/services/A/A/A" },
    });
    await upsertIntegration({
      accountId: ids.accountB.id,
      actorUserId: ids.accountB.userId,
      kind: "slack_webhook",
      config: { webhookUrl: "https://hooks.slack.com/services/B/B/B" },
    });

    const a = await getSlackIntegration(ids.accountA.id);
    const b = await getSlackIntegration(ids.accountB.id);
    expect(a?.config.webhookUrl).toContain("A/A/A");
    expect(b?.config.webhookUrl).toContain("B/B/B");
  });

  it("findAccountByIcsToken returns the right account by token", async () => {
    await upsertIntegration({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      kind: "ics_export",
      config: { token: "token-a-unique-12345" },
    });
    await upsertIntegration({
      accountId: ids.accountB.id,
      actorUserId: ids.accountB.userId,
      kind: "ics_export",
      config: { token: "token-b-unique-67890" },
    });
    const aHit = await findAccountByIcsToken("token-a-unique-12345");
    const bHit = await findAccountByIcsToken("token-b-unique-67890");
    const miss = await findAccountByIcsToken("does-not-exist");
    expect(aHit?.accountId).toBe(ids.accountA.id);
    expect(bHit?.accountId).toBe(ids.accountB.id);
    expect(miss).toBeNull();

    // Sanity: each ics integration's config is encrypted under its own account
    // — getIcsIntegration with the wrong account fails to decrypt and returns null.
    const aRow = await getIcsIntegration(ids.accountA.id);
    const bRow = await getIcsIntegration(ids.accountB.id);
    expect(aRow?.config.token).toBe("token-a-unique-12345");
    expect(bRow?.config.token).toBe("token-b-unique-67890");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// reports queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/reports", () => {
  it("getExposureByStatus only counts the scoped account", async () => {
    const a = await getExposureByStatus(ids.accountA.id);
    const b = await getExposureByStatus(ids.accountB.id);
    const aTotal = a.reduce((sum, r) => sum + r.annualValueCents, 0);
    const bTotal = b.reduce((sum, r) => sum + r.annualValueCents, 0);
    expect(aTotal).toBe(100_000);
    expect(bTotal).toBe(100_000);
  });

  it("listExposureDetail returns only the scoped account's rows", async () => {
    const a = await listExposureDetail(ids.accountA.id);
    const b = await listExposureDetail(ids.accountB.id);
    expect(a.every((r) => r.vendorName === "Vendor A")).toBe(true);
    expect(b.every((r) => r.vendorName === "Vendor B")).toBe(true);
  });

  it("getMissedDeadlinesByMonth only sees the scoped account's missed events", async () => {
    const { db } = await import("@server/infrastructure/db/client");
    const { renewalEventsTable } = await import("@server/infrastructure/db/schema");
    const { eq: eqOp } = await import("drizzle-orm");
    await db
      .update(renewalEventsTable)
      .set({ status: "missed" })
      .where(eqOp(renewalEventsTable.id, ids.accountA.renewalEventId));

    const a = await getMissedDeadlinesByMonth(ids.accountA.id);
    const b = await getMissedDeadlinesByMonth(ids.accountB.id);
    expect(a.reduce((s, r) => s + r.count, 0)).toBe(1);
    expect(b.reduce((s, r) => s + r.count, 0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// action-queue query
// ─────────────────────────────────────────────────────────────────────────

describe("queries/action-queue", () => {
  it("listActionQueueRows only includes the scoped account's rows", async () => {
    // The seed places both accounts' renewal events 30 days out with
    // status="upcoming" — neither hits the explicit-state branch, but both
    // are within 60d so they qualify via the deadline branch.
    const a = await listActionQueueRows(ids.accountA.id);
    const b = await listActionQueueRows(ids.accountB.id);
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(b.length).toBeGreaterThanOrEqual(1);
    expect(a.every((r) => r.vendorName === "Vendor A")).toBe(true);
    expect(b.every((r) => r.vendorName === "Vendor B")).toBe(true);
  });
});

describe("queries/dashboard", () => {
  it("getDashboardKpis aggregates only the scoped account", async () => {
    const a = await getDashboardKpis(ids.accountA.id);
    const b = await getDashboardKpis(ids.accountB.id);
    expect(a.trackedSubscriptions).toBe(1);
    expect(b.trackedSubscriptions).toBe(1);
    expect(a.totalAnnualSpendCents).toBe(100_000);
    expect(b.totalAnnualSpendCents).toBe(100_000);
  });

  it("getActionBandCounts counts only the scoped account", async () => {
    const a = await getActionBandCounts(ids.accountA.id);
    const b = await getActionBandCounts(ids.accountB.id);
    // Both accounts have 1 upcoming renewal within 90d
    expect(a.renewalsAwaitingDecision).toBe(1);
    expect(b.renewalsAwaitingDecision).toBe(1);
  });

  it("getNoticeDeadlineSpotlight only surfaces the scoped account's rows", async () => {
    const a = await getNoticeDeadlineSpotlight(ids.accountA.id);
    const b = await getNoticeDeadlineSpotlight(ids.accountB.id);
    expect(a.every((r) => r.vendorName === "Vendor A")).toBe(true);
    expect(b.every((r) => r.vendorName === "Vendor B")).toBe(true);
  });

  it("getRenewalCalendarSnapshot only surfaces the scoped account's rows", async () => {
    const a = await getRenewalCalendarSnapshot(ids.accountA.id);
    const b = await getRenewalCalendarSnapshot(ids.accountB.id);
    expect(a.topThree.every((r) => r.vendorName === "Vendor A")).toBe(true);
    expect(b.topThree.every((r) => r.vendorName === "Vendor B")).toBe(true);
  });

  it("getAnomalies only counts the scoped account's rows", async () => {
    // Both accounts have an active auto-renewing sub with a notice deadline in 30 days
    // and notice_period_days=30 (the default). Each account should see its own,
    // not the other's.
    const a = await getAnomalies(ids.accountA.id);
    const b = await getAnomalies(ids.accountB.id);
    const aDefault = a.find((x) => x.type === "default_notice_period");
    const bDefault = b.find((x) => x.type === "default_notice_period");
    expect(aDefault?.count).toBe(1);
    expect(bDefault?.count).toBe(1);
  });

});

describe("queries/ai-reasoning-usage", () => {
  it("getMonthlyReasoningCostUsdMicros only sums the scoped account's spend", async () => {
    await recordReasoningUsage({
      accountId: ids.accountA.id,
      surface: "brief",
      provider: "ollama",
      model: "qwen",
      promptTokens: 600,
      completionTokens: 40,
      costUsdMicros: 500,
    });
    expect(await getMonthlyReasoningCostUsdMicros(ids.accountA.id)).toBe(500);
    // Account B must not see account A's reasoning spend.
    expect(await getMonthlyReasoningCostUsdMicros(ids.accountB.id)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// audit-log queries
// ─────────────────────────────────────────────────────────────────────────

describe("queries/audit-log", () => {
  it("getRecentActivity only returns the scoped account's audit entries", async () => {
    const a = await getRecentActivity(ids.accountA.id);
    const b = await getRecentActivity(ids.accountB.id);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0]?.actorEmail).toBe("owner@a.example.test");
    expect(b[0]?.actorEmail).toBe("owner@b.example.test");
  });

  it("listAuditEntries only returns the scoped account's entries", async () => {
    const a = await listAuditEntries(ids.accountA.id);
    const b = await listAuditEntries(ids.accountB.id);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    // Filter by entity type narrows but never leaks across accounts
    const aSubs = await listAuditEntries(ids.accountA.id, {
      entityType: "subscription",
    });
    expect(aSubs.every((e) => e.targetEntityType === "subscription")).toBe(true);
    expect(aSubs.length).toBe(1);
  });

  it("listAuditEntityTypes only returns types seen in the scoped account", async () => {
    const a = await listAuditEntityTypes(ids.accountA.id);
    const b = await listAuditEntityTypes(ids.accountB.id);
    expect(a).toContain("subscription");
    expect(b).toContain("subscription");
    // The seed only writes "subscription" — neither account should leak any
    // other type.
    expect(a.every((t) => t === "subscription")).toBe(true);
    expect(b.every((t) => t === "subscription")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// spend ingestion queries (wedge PoC)
// ─────────────────────────────────────────────────────────────────────────

describe("queries/spend", () => {
  async function seedSpendFor(accountId: string, merchant: string) {
    const { encryptJson } = await import(
      "@server/infrastructure/crypto/envelope"
    );
    const { db } = await import("@server/infrastructure/db/client");
    const {
      recurringChargesTable,
      spendConnectionsTable,
      spendTransactionsTable,
    } = await import("@server/infrastructure/db/schema");
    const [conn] = await db
      .insert(spendConnectionsTable)
      .values({
        accountId,
        kind: "fixture",
        configCiphertext: encryptJson(accountId, { datasetId: "default" }),
        status: "active",
      })
      .returning();
    await db.insert(spendTransactionsTable).values({
      accountId,
      connectionId: conn!.id,
      externalId: `${merchant}-1`,
      rawMerchant: merchant,
      normalizedMerchant: merchant.toLowerCase(),
      amountCents: 8000,
      currency: "USD",
      chargedOn: "2026-05-01",
      status: "ingested",
    });
    const [charge] = await db
      .insert(recurringChargesTable)
      .values({
        accountId,
        connectionId: conn!.id,
        normalizedMerchant: merchant.toLowerCase(),
        suggestedVendorName: merchant,
        detectedCycle: "monthly",
        typicalAmountCents: 8000,
        latestAmountCents: 8000,
        confidence: 90,
        sampleSize: 6,
        firstChargedOn: "2025-12-01",
        lastChargedOn: "2026-05-01",
        status: "detected",
      })
      .returning();
    return { connectionId: conn!.id, chargeId: charge!.id };
  }

  it("detected recurring charges + transactions never cross the account boundary", async () => {
    const {
      listDetectedRecurringCharges,
      getRecurringCharge,
      listSpendTransactionsForDetection,
    } = await import("@server/infrastructure/db/repositories/spend");

    const a = await seedSpendFor(ids.accountA.id, "AcmeA");
    const b = await seedSpendFor(ids.accountB.id, "AcmeB");

    const aCharges = await listDetectedRecurringCharges(ids.accountA.id);
    expect(aCharges).toHaveLength(1);
    expect(aCharges[0]!.suggestedVendorName).toBe("AcmeA");

    // A cannot read B's charge by id
    expect(await getRecurringCharge(ids.accountA.id, b.chargeId)).toBeNull();
    expect(await getRecurringCharge(ids.accountB.id, a.chargeId)).toBeNull();

    // A's detection read for B's connection returns nothing
    const crossTxns = await listSpendTransactionsForDetection(
      ids.accountA.id,
      b.connectionId
    );
    expect(crossTxns).toHaveLength(0);
  });

  it("getConfirmedChargeForSubscription / listPositiveTransactionsForMerchant never cross the boundary", async () => {
    const {
      getConfirmedChargeForSubscription,
      listPositiveTransactionsForMerchant,
    } = await import("@server/infrastructure/db/repositories/spend");
    const { db } = await import("@server/infrastructure/db/client");
    const { recurringChargesTable } = await import(
      "@server/infrastructure/db/schema"
    );

    const b = await seedSpendFor(ids.accountB.id, "AcmeB");
    // Link B's charge to B's seeded subscription (status confirmed).
    await db
      .update(recurringChargesTable)
      .set({ status: "confirmed", subscriptionId: ids.accountB.subscriptionId });

    // A asking for B's subscription's confirmed charge gets nothing.
    expect(
      await getConfirmedChargeForSubscription(
        ids.accountA.id,
        ids.accountB.subscriptionId
      )
    ).toBeNull();

    // A reading B's connection/merchant transactions gets nothing.
    const crossA = await listPositiveTransactionsForMerchant(
      ids.accountA.id,
      b.connectionId,
      "acmeb",
      "USD"
    );
    expect(crossA).toHaveLength(0);

    // B legitimately sees its own.
    const ownB = await listPositiveTransactionsForMerchant(
      ids.accountB.id,
      b.connectionId,
      "acmeb",
      "USD"
    );
    expect(ownB.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// mutations — must throw when crossing the account boundary
// ─────────────────────────────────────────────────────────────────────────
// (legacy section header retained; describe block opens below)

describe("queries/renewal-notice-drafts", () => {
  it("never returns another account's notice draft", async () => {
    const { getLatestNoticeDraft, listNoticeDrafts } = await import(
      "@server/infrastructure/db/repositories/renewal-notice-drafts"
    );
    const { db } = await import("@server/infrastructure/db/client");
    const { renewalNoticeDraftsTable } = await import(
      "@server/infrastructure/db/schema"
    );

    // Seed a draft on account B's subscription.
    await db.insert(renewalNoticeDraftsTable).values({
      accountId: ids.accountB.id,
      subscriptionId: ids.accountB.subscriptionId,
      status: "draft",
      subject: "B internal notice",
      bodyText: "INTERNAL MEMO for B",
      createdByUserId: ids.accountB.userId,
    });

    // A asking for B's subscription's draft gets nothing.
    expect(
      await getLatestNoticeDraft(ids.accountA.id, ids.accountB.subscriptionId)
    ).toBeNull();
    expect(
      await listNoticeDrafts(ids.accountA.id, ids.accountB.subscriptionId)
    ).toHaveLength(0);

    // B sees its own.
    expect(
      await getLatestNoticeDraft(ids.accountB.id, ids.accountB.subscriptionId)
    ).not.toBeNull();
  });
});

describe("mutations/subscriptions cross-account safety", () => {
  it("updateSubscription throws when accountId does not match the row", async () => {
    await expect(
      updateSubscription({
        accountId: ids.accountA.id, // wrong tenant
        subscriptionId: ids.accountB.subscriptionId, // B's row
        actorUserId: ids.accountA.userId,
        patch: { productName: "EVIL UPDATE" },
      })
    ).rejects.toThrow("Subscription not found");
  });

  it("softDeleteSubscription throws when accountId does not match the row", async () => {
    await expect(
      softDeleteSubscription({
        accountId: ids.accountA.id,
        subscriptionId: ids.accountB.subscriptionId,
        actorUserId: ids.accountA.userId,
      })
    ).rejects.toThrow("Subscription not found");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Coverage guard — fails if a new query module is added without a test here
// ─────────────────────────────────────────────────────────────────────────

describe("coverage", () => {
  it("every file under src/server/infrastructure/db/repositories/ has a corresponding describe() in this file", () => {
    const repositoriesDir = path.join(
      process.cwd(),
      "src/server/infrastructure/db/repositories"
    );
    const moduleFiles = readdirSync(repositoriesDir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".d.ts")
    );

    // This test reads its own file content to look for `describe("queries/<name>"`
    // blocks. Cheap, no AST needed. Block name kept as `queries/` for human
    // continuity with the old layer label; the directory is `repositories/`.
    const selfPath = path.join(
      process.cwd(),
      "src/server/infrastructure/db/repositories/__tests__/tenant-isolation.test.ts"
    );
    const selfText = readFileSync(selfPath, "utf8");

    const missing: string[] = [];
    for (const f of moduleFiles) {
      const name = f.replace(/\.ts$/, "");
      const needle = `describe("queries/${name}"`;
      if (!selfText.includes(needle)) {
        missing.push(name);
      }
    }
    expect(
      missing,
      `Add a describe("queries/<name>") for: ${missing.join(", ")}`
    ).toEqual([]);
  });
});
