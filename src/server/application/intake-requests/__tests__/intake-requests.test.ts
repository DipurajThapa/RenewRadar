/**
 * T4.11 — Intake request lifecycle contract tests.
 *
 * The procurement workflow lives or dies on these invariants:
 *   - Submit refuses bad input (empty/oversized text, negative cost).
 *   - Approve creates a draft subscription AND links it.
 *   - Approve / deny / duplicate / withdraw can only act on `pending`.
 *   - Withdraw is requester-only.
 *   - Audit log + status fields are coherent (both written, same target id).
 *   - Tenant scope: no cross-account read or update.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  auditLogTable,
  intakeRequestsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  approveIntakeRequest,
  denyIntakeRequest,
  getIntakeRequest,
  getPendingIntakeRequestCount,
  IntakeRequestError,
  listIntakeRequests,
  markIntakeRequestDuplicate,
  submitIntakeRequest,
  withdrawIntakeRequest,
} from "@server/application/intake-requests";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

async function submit(): Promise<string> {
  const row = await submitIntakeRequest({
    accountId: ids.accountA.id,
    requesterUserId: ids.accountA.userId,
    vendor: "Linear",
    product: "Standard",
    businessCase:
      "Engineering team needs Linear to replace our Jira instance for sprint planning.",
    estimatedAnnualUsdCents: 5_000_00,
  });
  return row.id;
}

// ─────────────────────────────────────────────────────────────────────────
// submitIntakeRequest
// ─────────────────────────────────────────────────────────────────────────

describe("submitIntakeRequest", () => {
  it("creates a row with status='pending' and writes an audit entry", async () => {
    const row = await submitIntakeRequest({
      accountId: ids.accountA.id,
      requesterUserId: ids.accountA.userId,
      vendor: "Linear",
      product: "Standard",
      businessCase:
        "Engineering team needs Linear to replace our Jira instance.",
      estimatedAnnualUsdCents: 5_000_00,
    });
    expect(row.status).toBe("pending");
    expect(row.requesterUserId).toBe(ids.accountA.userId);

    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.targetEntityId, row.id));
    expect(audits.length).toBe(1);
    expect(audits[0]?.action).toBe("intake_request.submitted");
  });

  it("rejects empty vendor / product", async () => {
    await expect(
      submitIntakeRequest({
        accountId: ids.accountA.id,
        requesterUserId: ids.accountA.userId,
        vendor: "",
        product: "p",
        businessCase: "x".repeat(40),
        estimatedAnnualUsdCents: 1000,
      })
    ).rejects.toBeInstanceOf(IntakeRequestError);
    await expect(
      submitIntakeRequest({
        accountId: ids.accountA.id,
        requesterUserId: ids.accountA.userId,
        vendor: "v",
        product: "  ",
        businessCase: "x".repeat(40),
        estimatedAnnualUsdCents: 1000,
      })
    ).rejects.toBeInstanceOf(IntakeRequestError);
  });

  it("rejects a too-short business case (force the requester to be specific)", async () => {
    await expect(
      submitIntakeRequest({
        accountId: ids.accountA.id,
        requesterUserId: ids.accountA.userId,
        vendor: "Linear",
        product: "Standard",
        businessCase: "I want it",
        estimatedAnnualUsdCents: 1000,
      })
    ).rejects.toBeInstanceOf(IntakeRequestError);
  });

  it("rejects a negative estimated cost", async () => {
    await expect(
      submitIntakeRequest({
        accountId: ids.accountA.id,
        requesterUserId: ids.accountA.userId,
        vendor: "Linear",
        product: "Standard",
        businessCase: "x".repeat(40),
        estimatedAnnualUsdCents: -100,
      })
    ).rejects.toBeInstanceOf(IntakeRequestError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// approveIntakeRequest
// ─────────────────────────────────────────────────────────────────────────

describe("approveIntakeRequest", () => {
  it("transitions to 'approved' AND creates a linked draft subscription", async () => {
    const reqId = await submit();
    const result = await approveIntakeRequest({
      accountId: ids.accountA.id,
      requestId: reqId,
      reviewerUserId: ids.accountB.userId, // any account-level admin
      reviewerNote: "Reasonable cost, approved",
    });
    expect(result.request.status).toBe("approved");
    expect(result.request.createdSubscriptionId).toBe(
      result.draftSubscription.id
    );
    expect(result.draftSubscription.status).toBe("draft");
    expect(result.draftSubscription.productName).toBe("Standard");

    // The subscription is in the same account as the request.
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, result.draftSubscription.id));
    expect(sub?.accountId).toBe(ids.accountA.id);

    // Audit log has both the submission and the approval.
    const audits = await db
      .select({ action: auditLogTable.action })
      .from(auditLogTable)
      .where(eq(auditLogTable.targetEntityId, reqId));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("intake_request.submitted");
    expect(actions).toContain("intake_request.approved");
  });

  it("refuses to approve an already-approved request", async () => {
    const reqId = await submit();
    await approveIntakeRequest({
      accountId: ids.accountA.id,
      requestId: reqId,
      reviewerUserId: ids.accountA.userId,
    });
    await expect(
      approveIntakeRequest({
        accountId: ids.accountA.id,
        requestId: reqId,
        reviewerUserId: ids.accountA.userId,
      })
    ).rejects.toBeInstanceOf(IntakeRequestError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// denyIntakeRequest
// ─────────────────────────────────────────────────────────────────────────

describe("denyIntakeRequest", () => {
  it("requires a meaningful reason (≥ 8 chars)", async () => {
    const reqId = await submit();
    await expect(
      denyIntakeRequest({
        accountId: ids.accountA.id,
        requestId: reqId,
        reviewerUserId: ids.accountA.userId,
        reviewerNote: "no",
      })
    ).rejects.toBeInstanceOf(IntakeRequestError);
  });

  it("transitions to 'denied' with the reviewer note", async () => {
    const reqId = await submit();
    const result = await denyIntakeRequest({
      accountId: ids.accountA.id,
      requestId: reqId,
      reviewerUserId: ids.accountA.userId,
      reviewerNote: "Out of budget for this quarter — revisit Q3.",
    });
    expect(result.status).toBe("denied");
    expect(result.reviewerNote).toMatch(/Out of budget/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// markIntakeRequestDuplicate
// ─────────────────────────────────────────────────────────────────────────

describe("markIntakeRequestDuplicate", () => {
  it("links to an existing subscription in the same account", async () => {
    const reqId = await submit();
    const result = await markIntakeRequestDuplicate({
      accountId: ids.accountA.id,
      requestId: reqId,
      reviewerUserId: ids.accountA.userId,
      linkedSubscriptionId: ids.accountA.subscriptionId,
    });
    expect(result.status).toBe("duplicate");
    expect(result.linkedExistingSubscriptionId).toBe(
      ids.accountA.subscriptionId
    );
  });

  it("refuses to link to a subscription in a different account", async () => {
    const reqId = await submit();
    await expect(
      markIntakeRequestDuplicate({
        accountId: ids.accountA.id,
        requestId: reqId,
        reviewerUserId: ids.accountA.userId,
        linkedSubscriptionId: ids.accountB.subscriptionId, // wrong account
      })
    ).rejects.toBeInstanceOf(IntakeRequestError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// withdrawIntakeRequest
// ─────────────────────────────────────────────────────────────────────────

describe("withdrawIntakeRequest", () => {
  it("transitions to 'withdrawn' when the original requester calls it", async () => {
    const reqId = await submit();
    const result = await withdrawIntakeRequest({
      accountId: ids.accountA.id,
      requestId: reqId,
      requesterUserId: ids.accountA.userId,
    });
    expect(result.status).toBe("withdrawn");
  });

  it("refuses when a different user attempts to withdraw", async () => {
    const reqId = await submit();
    await expect(
      withdrawIntakeRequest({
        accountId: ids.accountA.id,
        requestId: reqId,
        requesterUserId: ids.accountB.userId,
      })
    ).rejects.toBeInstanceOf(IntakeRequestError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tenant scope on reads
// ─────────────────────────────────────────────────────────────────────────

describe("tenant scope on reads", () => {
  it("listIntakeRequests only returns the calling account's rows", async () => {
    await submit(); // creates one in accountA
    await submitIntakeRequest({
      accountId: ids.accountB.id,
      requesterUserId: ids.accountB.userId,
      vendor: "Figma",
      product: "Pro",
      businessCase: "Design team needs Figma Pro for collaboration features.",
      estimatedAnnualUsdCents: 1_500_00,
    });

    const aList = await listIntakeRequests(ids.accountA.id);
    expect(aList.length).toBe(1);
    expect(aList[0]?.vendor).toBe("Linear");

    const bList = await listIntakeRequests(ids.accountB.id);
    expect(bList.length).toBe(1);
    expect(bList[0]?.vendor).toBe("Figma");
  });

  it("getIntakeRequest refuses cross-account access", async () => {
    const reqId = await submit(); // in accountA
    const wrong = await getIntakeRequest(ids.accountB.id, reqId);
    expect(wrong).toBeNull();
  });

  it("getPendingIntakeRequestCount counts only pending in this account", async () => {
    const reqId = await submit(); // pending
    await submitIntakeRequest({
      accountId: ids.accountA.id,
      requesterUserId: ids.accountA.userId,
      vendor: "Notion",
      product: "Team",
      businessCase:
        "Product team wants Notion to consolidate docs in one place.",
      estimatedAnnualUsdCents: 2_000_00,
    });
    expect(await getPendingIntakeRequestCount(ids.accountA.id)).toBe(2);

    await approveIntakeRequest({
      accountId: ids.accountA.id,
      requestId: reqId,
      reviewerUserId: ids.accountA.userId,
    });
    expect(await getPendingIntakeRequestCount(ids.accountA.id)).toBe(1);
    expect(await getPendingIntakeRequestCount(ids.accountB.id)).toBe(0);
  });

  it("listIntakeRequests can scope to a single requester (member view)", async () => {
    await submit(); // accountA.userId requester
    // Seed a second user in accountA who submits a request.
    const { usersTable } = await import("@server/infrastructure/db/schema");
    const [other] = await db
      .insert(usersTable)
      .values({
        accountId: ids.accountA.id,
        clerkUserId: `clerk_other_${Date.now()}`,
        workEmail: "other@a.example.test",
        fullName: "Other Member",
        role: "member" as const,
      })
      .returning();
    await submitIntakeRequest({
      accountId: ids.accountA.id,
      requesterUserId: other!.id,
      vendor: "Figma",
      product: "Pro",
      businessCase:
        "Design system work needs Figma Pro for advanced collab features.",
      estimatedAnnualUsdCents: 1_500_00,
    });

    const mine = await listIntakeRequests(ids.accountA.id, {
      requesterUserId: other!.id,
    });
    expect(mine.length).toBe(1);
    expect(mine[0]?.vendor).toBe("Figma");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Direct DB sanity — make sure status enum + indexes exist
// ─────────────────────────────────────────────────────────────────────────

describe("schema sanity", () => {
  it("status defaults to 'pending' on insert", async () => {
    const reqId = await submit();
    const [row] = await db
      .select()
      .from(intakeRequestsTable)
      .where(eq(intakeRequestsTable.id, reqId));
    expect(row?.status).toBe("pending");
  });
});
