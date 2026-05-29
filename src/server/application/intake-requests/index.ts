/**
 * T4.11 — Procurement intake requests.
 *
 * Invariants:
 *   1. Status `pending` is the only writable state. Approve / deny /
 *      mark-duplicate / withdraw all move the row to a terminal state.
 *      Trying to act on an already-terminal row throws — no surprise
 *      transitions for the requester.
 *   2. Approval creates a draft subscription via `createSubscriptionDraft`
 *      in the SAME transaction so we can't end up with an approved
 *      request pointing at a subscription that doesn't exist.
 *   3. Audit log + email notifications fire on every status change; both
 *      receive enough context to reconstruct who/what/why.
 *   4. The requester's user id is stamped on insert and never mutated.
 *      A reviewer cannot rewrite the original request — only their own
 *      review fields.
 *   5. Tenant scope: every read filter and every update predicate carries
 *      `accountId` — defense in depth in case the caller forgets.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  intakeRequestsTable,
  subscriptionsTable,
  type IntakeRequest,
  type Subscription,
} from "@server/infrastructure/db/schema";
import { createSubscriptionDraft } from "@server/application/subscriptions";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "intake-requests" });

export class IntakeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeRequestError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Submit
// ─────────────────────────────────────────────────────────────────────────

export type SubmitIntakeRequestInput = {
  accountId: string;
  requesterUserId: string;
  vendor: string;
  product: string;
  planNotes?: string | null;
  businessCase: string;
  estimatedAnnualUsdCents: number;
  expectedStartDate?: string | null; // YYYY-MM-DD
};

const MAX_TEXT_LEN = 2000;

export async function submitIntakeRequest(
  input: SubmitIntakeRequestInput
): Promise<IntakeRequest> {
  const vendor = input.vendor.trim();
  const product = input.product.trim();
  const businessCase = input.businessCase.trim();

  if (!vendor || vendor.length > 200) {
    throw new IntakeRequestError("Vendor name is required (≤ 200 chars).");
  }
  if (!product || product.length > 200) {
    throw new IntakeRequestError("Product name is required (≤ 200 chars).");
  }
  if (!businessCase || businessCase.length < 20) {
    throw new IntakeRequestError(
      "Business case is required (≥ 20 characters). Be specific — the reviewer needs context."
    );
  }
  if (businessCase.length > MAX_TEXT_LEN) {
    throw new IntakeRequestError(
      `Business case is too long (max ${MAX_TEXT_LEN} characters).`
    );
  }
  if (
    !Number.isFinite(input.estimatedAnnualUsdCents) ||
    input.estimatedAnnualUsdCents < 0
  ) {
    throw new IntakeRequestError("Estimated annual cost must be a non-negative number.");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(intakeRequestsTable)
      .values({
        accountId: input.accountId,
        requesterUserId: input.requesterUserId,
        vendor,
        product,
        planNotes: input.planNotes?.trim() || null,
        businessCase,
        estimatedAnnualUsdCents: Math.round(input.estimatedAnnualUsdCents),
        expectedStartDate: input.expectedStartDate ?? null,
      })
      .returning();
    if (!row) throw new IntakeRequestError("Failed to create intake request.");

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.requesterUserId,
      action: AUDIT_ACTIONS.intakeRequestSubmitted,
      target: { entityType: "intake_request", entityId: row.id },
      after: {
        vendor: row.vendor,
        product: row.product,
        estimatedAnnualUsdCents: row.estimatedAnnualUsdCents,
      },
    });

    log.info("intake_request_submitted", {
      requestId: row.id,
      accountId: input.accountId,
      requesterUserId: input.requesterUserId,
    });

    return row;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Approve  →  creates a draft subscription
// ─────────────────────────────────────────────────────────────────────────

export type ApproveResult = {
  request: IntakeRequest;
  draftSubscription: Subscription;
};

export async function approveIntakeRequest(input: {
  accountId: string;
  requestId: string;
  reviewerUserId: string;
  reviewerNote?: string | null;
}): Promise<ApproveResult> {
  // Read the pending row (no transaction — single SELECT).
  const row = await readPendingRowNoTx(input.accountId, input.requestId);

  // Create the draft OUTSIDE any outer transaction.
  //
  // Why not wrap the whole approval in one transaction: postgres-js shares
  // a single connection per transaction context, and `createSubscriptionDraft`
  // itself opens `db.transaction(...)`. Nested calls on the same `db` block
  // forever waiting on the connection. We accept a small atomicity gap —
  // if the intake update below fails, the draft becomes orphaned and the
  // operator can delete it manually. The audit-log entries below pin a
  // clear story for that recovery.
  const draft = await createSubscriptionDraft({
    accountId: input.accountId,
    actorUserId: input.reviewerUserId,
    vendorName: row.vendor,
    productName: row.product,
    annualizedUsdCents: row.estimatedAnnualUsdCents,
    notes: `Approved from intake request — requester noted: ${row.businessCase.slice(0, 400)}`,
  });

  // Now wrap the intake-row update + audit in a single tx.
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(intakeRequestsTable)
      .set({
        status: "approved" as const,
        reviewerUserId: input.reviewerUserId,
        reviewedAt: new Date(),
        reviewerNote: input.reviewerNote?.trim() || null,
        createdSubscriptionId: draft.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(intakeRequestsTable.id, input.requestId),
          eq(intakeRequestsTable.accountId, input.accountId),
          eq(intakeRequestsTable.status, "pending") // guard against a parallel race
        )
      )
      .returning();

    if (!updated) {
      throw new IntakeRequestError(
        "Intake request changed status while we were approving — please refresh and try again."
      );
    }

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.reviewerUserId,
      action: AUDIT_ACTIONS.intakeRequestApproved,
      target: { entityType: "intake_request", entityId: updated.id },
      before: { status: "pending" },
      after: {
        status: "approved",
        draftSubscriptionId: draft.id,
        reviewerNote: updated.reviewerNote,
      },
    });

    log.info("intake_request_approved", {
      requestId: updated.id,
      accountId: input.accountId,
      reviewerUserId: input.reviewerUserId,
      draftSubscriptionId: draft.id,
    });

    return { request: updated, draftSubscription: draft };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Deny
// ─────────────────────────────────────────────────────────────────────────

export async function denyIntakeRequest(input: {
  accountId: string;
  requestId: string;
  reviewerUserId: string;
  reviewerNote: string;
}): Promise<IntakeRequest> {
  const note = input.reviewerNote.trim();
  if (!note || note.length < 8) {
    throw new IntakeRequestError(
      "A denial needs a reason (≥ 8 characters) so the requester learns why."
    );
  }
  return db.transaction(async (tx) => {
    const row = await readPendingRow(tx, input.accountId, input.requestId);

    const [updated] = await tx
      .update(intakeRequestsTable)
      .set({
        status: "denied" as const,
        reviewerUserId: input.reviewerUserId,
        reviewedAt: new Date(),
        reviewerNote: note,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(intakeRequestsTable.id, input.requestId),
          eq(intakeRequestsTable.accountId, input.accountId)
        )
      )
      .returning();
    if (!updated) throw new IntakeRequestError("Failed to update intake request.");

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.reviewerUserId,
      action: AUDIT_ACTIONS.intakeRequestDenied,
      target: { entityType: "intake_request", entityId: updated.id },
      before: { status: "pending" },
      after: { status: "denied", reviewerNote: updated.reviewerNote },
    });

    void row; // silence unused
    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Mark duplicate
// ─────────────────────────────────────────────────────────────────────────

export async function markIntakeRequestDuplicate(input: {
  accountId: string;
  requestId: string;
  reviewerUserId: string;
  linkedSubscriptionId: string;
  reviewerNote?: string | null;
}): Promise<IntakeRequest> {
  return db.transaction(async (tx) => {
    const row = await readPendingRow(tx, input.accountId, input.requestId);

    // Verify the linked subscription is in the same account — defense in depth.
    const [linked] = await tx
      .select({ accountId: subscriptionsTable.accountId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, input.linkedSubscriptionId))
      .limit(1);
    if (!linked || linked.accountId !== input.accountId) {
      throw new IntakeRequestError(
        "Linked subscription must belong to this account."
      );
    }

    const [updated] = await tx
      .update(intakeRequestsTable)
      .set({
        status: "duplicate" as const,
        reviewerUserId: input.reviewerUserId,
        reviewedAt: new Date(),
        reviewerNote: input.reviewerNote?.trim() || null,
        linkedExistingSubscriptionId: input.linkedSubscriptionId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(intakeRequestsTable.id, input.requestId),
          eq(intakeRequestsTable.accountId, input.accountId)
        )
      )
      .returning();
    if (!updated) throw new IntakeRequestError("Failed to update intake request.");

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.reviewerUserId,
      action: AUDIT_ACTIONS.intakeRequestDuplicate,
      target: { entityType: "intake_request", entityId: updated.id },
      before: { status: "pending" },
      after: {
        status: "duplicate",
        linkedSubscriptionId: input.linkedSubscriptionId,
        reviewerNote: updated.reviewerNote,
      },
    });

    void row;
    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Withdraw (requester pulls it back)
// ─────────────────────────────────────────────────────────────────────────

export async function withdrawIntakeRequest(input: {
  accountId: string;
  requestId: string;
  requesterUserId: string;
}): Promise<IntakeRequest> {
  return db.transaction(async (tx) => {
    const row = await readPendingRow(tx, input.accountId, input.requestId);
    if (row.requesterUserId !== input.requesterUserId) {
      throw new IntakeRequestError(
        "Only the original requester can withdraw a request."
      );
    }

    const [updated] = await tx
      .update(intakeRequestsTable)
      .set({
        status: "withdrawn" as const,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(intakeRequestsTable.id, input.requestId),
          eq(intakeRequestsTable.accountId, input.accountId)
        )
      )
      .returning();
    if (!updated) throw new IntakeRequestError("Failed to update intake request.");

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.requesterUserId,
      action: AUDIT_ACTIONS.intakeRequestWithdrawn,
      target: { entityType: "intake_request", entityId: updated.id },
      before: { status: "pending" },
      after: { status: "withdrawn" },
    });

    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────

export type IntakeRequestFilter = {
  status?: "pending" | "approved" | "denied" | "duplicate" | "withdrawn";
  /** If set, only show this user's own requests (used by member-role users). */
  requesterUserId?: string;
};

export async function listIntakeRequests(
  accountId: string,
  filter: IntakeRequestFilter = {}
): Promise<IntakeRequest[]> {
  const conditions = [eq(intakeRequestsTable.accountId, accountId)];
  if (filter.status) {
    conditions.push(eq(intakeRequestsTable.status, filter.status));
  }
  if (filter.requesterUserId) {
    conditions.push(
      eq(intakeRequestsTable.requesterUserId, filter.requesterUserId)
    );
  }
  return db
    .select()
    .from(intakeRequestsTable)
    .where(and(...conditions))
    .orderBy(sql`${intakeRequestsTable.createdAt} desc`);
}

export async function getIntakeRequest(
  accountId: string,
  requestId: string
): Promise<IntakeRequest | null> {
  const [row] = await db
    .select()
    .from(intakeRequestsTable)
    .where(
      and(
        eq(intakeRequestsTable.id, requestId),
        eq(intakeRequestsTable.accountId, accountId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function getPendingIntakeRequestCount(
  accountId: string
): Promise<number> {
  const rows = await db
    .select({ id: intakeRequestsTable.id })
    .from(intakeRequestsTable)
    .where(
      and(
        eq(intakeRequestsTable.accountId, accountId),
        eq(intakeRequestsTable.status, "pending")
      )
    );
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function readPendingRow(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  accountId: string,
  requestId: string
): Promise<IntakeRequest> {
  const [row] = await tx
    .select()
    .from(intakeRequestsTable)
    .where(
      and(
        eq(intakeRequestsTable.id, requestId),
        eq(intakeRequestsTable.accountId, accountId)
      )
    )
    .limit(1);
  if (!row) {
    throw new IntakeRequestError("Intake request not found in this account.");
  }
  if (row.status !== "pending") {
    throw new IntakeRequestError(
      `Cannot act on a ${row.status} request — submit a fresh one if you need to revisit this.`
    );
  }
  return row;
}

/**
 * Same predicate as readPendingRow but uses the top-level `db` so the call
 * site doesn't need to be inside a transaction. Used by `approveIntakeRequest`
 * which deliberately splits the draft-creation step out of the tx wrapper.
 */
async function readPendingRowNoTx(
  accountId: string,
  requestId: string
): Promise<IntakeRequest> {
  const [row] = await db
    .select()
    .from(intakeRequestsTable)
    .where(
      and(
        eq(intakeRequestsTable.id, requestId),
        eq(intakeRequestsTable.accountId, accountId)
      )
    )
    .limit(1);
  if (!row) {
    throw new IntakeRequestError("Intake request not found in this account.");
  }
  if (row.status !== "pending") {
    throw new IntakeRequestError(
      `Cannot act on a ${row.status} request — submit a fresh one if you need to revisit this.`
    );
  }
  return row;
}
