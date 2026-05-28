"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalEventsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";
import {
  upsertSavingsRecordFromDecision,
} from "@server/application/savings";
import { annualizeCents } from "@server/domain/billing/annualize";
import type { SavingsKind } from "@server/infrastructure/db/schema";

export type ApprovalResult = { ok: true } | { ok: false; error: string };

/**
 * Approve or reject a pending renewal decision under approvals-lite.
 *
 * Rules:
 *   - Caller must have admin or owner role.
 *   - Caller must be DIFFERENT from the user who recorded the decision —
 *     separation of duties is the whole point of approvals.
 *   - Approval flips renewal_event.status → "processed", writes savings if
 *     applicable, and (if decision = cancelled) moves the subscription to
 *     "pending_cancellation".
 *   - Rejection wipes the decision fields and returns the renewal_event to
 *     whatever status it had before the decision was recorded ("upcoming"
 *     is the safe default).
 */
export async function approveRenewalDecisionAction(
  renewalEventId: string,
  approve: boolean
): Promise<ApprovalResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  type Context = {
    subscriptionId: string;
    kind: SavingsKind;
    baselineAnnualUsdCents: number;
    newAnnualUsdCents?: number;
    decisionNote: string | null;
  };

  let savingsContext: Context | null = null;

  try {
    savingsContext = await db.transaction(async (tx): Promise<Context | null> => {
      const [renewal] = await tx
        .select()
        .from(renewalEventsTable)
        .where(
          and(
            eq(renewalEventsTable.id, renewalEventId),
            eq(renewalEventsTable.accountId, account.id)
          )
        );
      if (!renewal) throw new Error("Renewal event not found");
      if (renewal.approvalStatus !== "pending") {
        throw new Error(`Decision is not pending approval (state: ${renewal.approvalStatus})`);
      }
      if (renewal.decidedByUserId === user.id) {
        throw new Error("You cannot approve your own decision");
      }
      if (!renewal.decision) {
        throw new Error("No decision to approve");
      }

      const [sub] = await tx
        .select()
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.id, renewal.subscriptionId),
            eq(subscriptionsTable.accountId, account.id)
          )
        );
      if (!sub) throw new Error("Subscription not found");

      if (approve) {
        await tx
          .update(renewalEventsTable)
          .set({
            status: "processed",
            approvalStatus: "approved",
            approvedByUserId: user.id,
            approvedAt: new Date(),
          })
          .where(eq(renewalEventsTable.id, renewal.id));

        if (renewal.decision === "cancelled") {
          await tx
            .update(subscriptionsTable)
            .set({ status: "pending_cancellation" })
            .where(eq(subscriptionsTable.id, sub.id));
        }

        await writeAuditLog(tx, {
          accountId: account.id,
          actorUserId: user.id,
          action: AUDIT_ACTIONS.renewalDecisionApproved,
          target: { entityType: "renewal_event", entityId: renewal.id },
          after: {
            decision: renewal.decision,
            decidedByUserId: renewal.decidedByUserId,
            approvedByUserId: user.id,
          },
        });

        // Derive savings context to apply outside the transaction.
        const baseline = annualizeCents(
          sub.totalCostPerPeriodCents,
          sub.billingCycle
        );
        const kind = decisionToSavingsKind(renewal.decision);
        if (!kind) return null;
        let newAnnual: number | undefined;
        if (
          renewal.adjustedSeatCount !== null &&
          renewal.adjustedUnitPriceCents !== null
        ) {
          newAnnual = annualizeCents(
            renewal.adjustedSeatCount * renewal.adjustedUnitPriceCents,
            sub.billingCycle
          );
        }
        return {
          subscriptionId: sub.id,
          kind,
          baselineAnnualUsdCents: baseline,
          newAnnualUsdCents: newAnnual,
          decisionNote: renewal.decisionNote,
        };
      } else {
        // Reject: wipe the decision and the approval.
        await tx
          .update(renewalEventsTable)
          .set({
            status: "upcoming",
            decision: null,
            decisionAt: null,
            decidedByUserId: null,
            decisionNote: null,
            adjustedSeatCount: null,
            adjustedUnitPriceCents: null,
            approvalStatus: "rejected",
            approvedByUserId: user.id,
            approvedAt: new Date(),
          })
          .where(eq(renewalEventsTable.id, renewal.id));

        await writeAuditLog(tx, {
          accountId: account.id,
          actorUserId: user.id,
          action: AUDIT_ACTIONS.renewalDecisionRejected,
          target: { entityType: "renewal_event", entityId: renewal.id },
          before: {
            decision: renewal.decision,
            decidedByUserId: renewal.decidedByUserId,
          },
          after: { approvedByUserId: user.id },
        });
        return null;
      }
    });

    const ctx = savingsContext;
    if (ctx) {
      try {
        await upsertSavingsRecordFromDecision({
          accountId: account.id,
          actorUserId: user.id,
          renewalEventId,
          subscriptionId: ctx.subscriptionId,
          kind: ctx.kind,
          baselineAnnualUsdCents: ctx.baselineAnnualUsdCents,
          newAnnualUsdCents: ctx.newAnnualUsdCents,
          note: ctx.decisionNote,
        });
      } catch (err) {
        console.error("[approveRenewalDecisionAction] savings failed:", err);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[approveRenewalDecisionAction] failed:", err);
    return { ok: false, error: msg };
  }

  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath("/action-queue");
  revalidatePath("/reports");
  revalidatePath("/subscriptions");
  return { ok: true };
}

function decisionToSavingsKind(decision: string): SavingsKind | null {
  switch (decision) {
    case "cancelled":
      return "cancelled";
    case "downgraded":
      return "downgraded";
    case "renewed_with_adjustments":
      return "renegotiated";
    default:
      return null;
  }
}
