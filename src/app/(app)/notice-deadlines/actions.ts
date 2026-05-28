"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/infrastructure/db/client";
import {
  decisionContextsTable,
  renewalEventsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";
import { upsertSavingsRecordFromDecision } from "@server/application/savings";
import { annualizeCents } from "@server/domain/billing/annualize";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";
import type {
  DecisionRationaleCode,
  NegotiationLever,
  SavingsKind,
} from "@server/infrastructure/db/schema";

const decisionEnum = z.enum([
  "renewed",
  "renewed_with_adjustments",
  "downgraded",
  "cancelled",
]);
type DecisionType = z.infer<typeof decisionEnum>;

/** Enumerated rationale codes — must match decisionRationaleCodeEnum exactly. */
const rationaleCodeEnum = z.enum([
  "cost_reduction",
  "low_usage",
  "poor_performance",
  "no_longer_needed",
  "found_alternative",
  "strategic_pivot",
  "security_concern",
  "compliance_concern",
  "consolidation",
  "team_change",
  "vendor_acquired",
  "price_too_high",
  "missing_features",
  "support_issues",
]);

const negotiationLeverEnum = z.enum([
  "none",
  "multi_year_commit",
  "payment_terms",
  "volume_increase",
  "competing_quote",
  "executive_escalation",
  "consolidated_with_other_products",
  "threatened_cancellation",
  "other",
]);

const logDecisionSchema = z.object({
  renewalEventId: z.string().uuid(),
  decision: decisionEnum,
  decisionNote: z.string().max(2000).optional().nullable(),
  adjustedSeatCount: z.coerce.number().int().min(0).optional().nullable(),
  adjustedUnitPriceCents: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .nullable(),
  // Enhanced rationale capture — all optional so existing call sites
  // (older form versions) continue to work.
  rationaleCodes: z.array(rationaleCodeEnum).optional(),
  alternativesConsidered: z.string().max(2000).optional().nullable(),
  stakeholderUserIds: z.array(z.string().uuid()).optional(),
  negotiationLever: negotiationLeverEnum.optional(),
  negotiationOutcomeSummary: z.string().max(2000).optional().nullable(),
  expectedAnnualSavingsUsdCents: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .nullable(),
});

export type LogDecisionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function logRenewalDecisionAction(
  formData: FormData
): Promise<LogDecisionResult> {
  const { account, user } = await getCurrentAccountAndUser();

  // Coerce form data into the shape Zod expects
  const decisionNote = (formData.get("decisionNote") ?? "").toString().trim();
  const adjustedSeatRaw = formData.get("adjustedSeatCount");
  const adjustedPriceRaw = formData.get("adjustedUnitPriceDollars");

  const adjustedSeatCount =
    adjustedSeatRaw && String(adjustedSeatRaw).trim() !== ""
      ? Number(adjustedSeatRaw)
      : null;
  const adjustedUnitPriceCents =
    adjustedPriceRaw && String(adjustedPriceRaw).trim() !== ""
      ? Math.round(Number(adjustedPriceRaw) * 100)
      : null;

  // Multi-select fields arrive from FormData as a series of repeated entries
  // (e.g. <input name="rationaleCodes" value="cost_reduction" /> × N).
  // FormData.getAll() collects them.
  const rationaleCodes = formData.getAll("rationaleCodes").map(String).filter(Boolean);
  const stakeholderUserIds = formData
    .getAll("stakeholderUserIds")
    .map(String)
    .filter(Boolean);
  const negotiationLeverRaw = formData.get("negotiationLever");
  const negotiationOutcomeRaw = formData.get("negotiationOutcomeSummary");
  const alternativesRaw = formData.get("alternativesConsidered");
  const expectedSavingsRaw = formData.get("expectedAnnualSavingsUsdCents");

  const parsed = logDecisionSchema.safeParse({
    renewalEventId: formData.get("renewalEventId"),
    decision: formData.get("decision"),
    decisionNote: decisionNote === "" ? null : decisionNote,
    adjustedSeatCount,
    adjustedUnitPriceCents,
    rationaleCodes: rationaleCodes.length > 0 ? rationaleCodes : undefined,
    alternativesConsidered:
      typeof alternativesRaw === "string" && alternativesRaw.trim()
        ? alternativesRaw
        : null,
    stakeholderUserIds:
      stakeholderUserIds.length > 0 ? stakeholderUserIds : undefined,
    negotiationLever:
      typeof negotiationLeverRaw === "string" && negotiationLeverRaw
        ? negotiationLeverRaw
        : undefined,
    negotiationOutcomeSummary:
      typeof negotiationOutcomeRaw === "string" && negotiationOutcomeRaw.trim()
        ? negotiationOutcomeRaw
        : null,
    expectedAnnualSavingsUsdCents:
      expectedSavingsRaw && String(expectedSavingsRaw).trim() !== ""
        ? Math.round(Number(expectedSavingsRaw) * 100)
        : null,
  });

  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }

  type SavingsContext = {
    subscriptionId: string;
    kind: SavingsKind;
    baselineAnnualUsdCents: number;
    newAnnualUsdCents?: number;
  };

  let savingsContext: SavingsContext | null = null;
  try {
    savingsContext = await db.transaction(async (tx): Promise<SavingsContext | null> => {
      // 1. Verify the renewal event belongs to this account
      const [existing] = await tx
        .select()
        .from(renewalEventsTable)
        .where(
          and(
            eq(renewalEventsTable.id, parsed.data.renewalEventId),
            eq(renewalEventsTable.accountId, account.id)
          )
        );
      if (!existing) {
        throw new Error("Renewal event not found");
      }

      // Load the subscription so we can compute baseline savings.
      const [sub] = await tx
        .select()
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.id, existing.subscriptionId),
            eq(subscriptionsTable.accountId, account.id)
          )
        );
      if (!sub) {
        throw new Error("Subscription not found");
      }

      // 2. Update renewal event with decision.
      //
      // Approvals-lite: if the account has `requireApprovals` on, the decision
      // is marked `pending` and not yet "processed". A second admin/owner
      // then approves it via approveRenewalDecisionAction, which flips
      // status → "processed" and updates downstream state. Until then the
      // alert cron continues to treat the renewal as undecided.
      const needsApproval = account.requireApprovals === true;
      await tx
        .update(renewalEventsTable)
        .set({
          status: needsApproval ? existing.status : "processed",
          decision: parsed.data.decision,
          decisionAt: new Date(),
          decidedByUserId: user.id,
          decisionNote: parsed.data.decisionNote ?? null,
          adjustedSeatCount: parsed.data.adjustedSeatCount ?? null,
          adjustedUnitPriceCents: parsed.data.adjustedUnitPriceCents ?? null,
          approvalStatus: needsApproval ? "pending" : "not_required",
          approvedByUserId: null,
          approvedAt: null,
        })
        .where(eq(renewalEventsTable.id, parsed.data.renewalEventId));

      // 3. If cancelled AND not pending approval, move subscription state.
      //    Under approvals-lite we wait for the approver before touching
      //    the subscription so a mid-process rejection is reversible.
      if (parsed.data.decision === "cancelled" && !needsApproval) {
        await tx
          .update(subscriptionsTable)
          .set({ status: "pending_cancellation" })
          .where(eq(subscriptionsTable.id, existing.subscriptionId));
      }

      await writeAuditLog(tx, {
        accountId: account.id,
        actorUserId: user.id,
        action: AUDIT_ACTIONS.renewalDecisionLogged,
        target: {
          entityType: "renewal_event",
          entityId: parsed.data.renewalEventId,
        },
        after: {
          decision: parsed.data.decision,
          decisionNote: parsed.data.decisionNote,
          adjustedSeatCount: parsed.data.adjustedSeatCount,
          adjustedUnitPriceCents: parsed.data.adjustedUnitPriceCents,
        },
      });

      // Decision context — captures the structured "why" behind the decision
      // so future operators can reconstruct the business reasoning years
      // later. Optional; only written when the user filled in rationale UI.
      const hasContext =
        (parsed.data.rationaleCodes && parsed.data.rationaleCodes.length > 0) ||
        parsed.data.alternativesConsidered ||
        (parsed.data.stakeholderUserIds &&
          parsed.data.stakeholderUserIds.length > 0) ||
        (parsed.data.negotiationLever &&
          parsed.data.negotiationLever !== "none") ||
        parsed.data.negotiationOutcomeSummary ||
        parsed.data.expectedAnnualSavingsUsdCents;
      if (hasContext) {
        await tx
          .insert(decisionContextsTable)
          .values({
            accountId: account.id,
            renewalEventId: parsed.data.renewalEventId,
            rationaleCodesJson: (parsed.data.rationaleCodes ?? []) as DecisionRationaleCode[] as unknown as Record<string, unknown>,
            alternativesConsidered: parsed.data.alternativesConsidered ?? null,
            stakeholdersConsultedJson:
              (parsed.data.stakeholderUserIds ?? []) as unknown as Record<string, unknown>,
            negotiationLever:
              (parsed.data.negotiationLever ?? "none") as NegotiationLever,
            negotiationOutcomeSummary:
              parsed.data.negotiationOutcomeSummary ?? null,
            expectedAnnualSavingsUsdCents:
              parsed.data.expectedAnnualSavingsUsdCents ?? null,
            createdByUserId: user.id,
          })
          .onConflictDoUpdate({
            target: decisionContextsTable.renewalEventId,
            set: {
              rationaleCodesJson:
                (parsed.data.rationaleCodes ?? []) as DecisionRationaleCode[] as unknown as Record<string, unknown>,
              alternativesConsidered:
                parsed.data.alternativesConsidered ?? null,
              stakeholdersConsultedJson:
                (parsed.data.stakeholderUserIds ?? []) as unknown as Record<string, unknown>,
              negotiationLever:
                (parsed.data.negotiationLever ?? "none") as NegotiationLever,
              negotiationOutcomeSummary:
                parsed.data.negotiationOutcomeSummary ?? null,
              expectedAnnualSavingsUsdCents:
                parsed.data.expectedAnnualSavingsUsdCents ?? null,
              updatedAt: new Date(),
            },
          });
      }

      // Vendor memory — record the decision so the per-vendor timeline shows
      // it forever (with full rationale).
      await recordVendorEvent(tx, {
        accountId: account.id,
        vendorId: sub.vendorId,
        subscriptionId: sub.id,
        kind: "renewal_decision_logged",
        payload: {
          decision: parsed.data.decision,
          rationaleCodes: parsed.data.rationaleCodes as
            | DecisionRationaleCode[]
            | undefined,
          alternativesConsidered: parsed.data.alternativesConsidered,
          stakeholderUserIds: parsed.data.stakeholderUserIds,
          negotiationLever: parsed.data.negotiationLever as
            | NegotiationLever
            | undefined,
          negotiationOutcomeSummary: parsed.data.negotiationOutcomeSummary,
          expectedAnnualSavingsUsdCents:
            parsed.data.expectedAnnualSavingsUsdCents,
          adjustedSeatCount: parsed.data.adjustedSeatCount,
          adjustedUnitPriceCents: parsed.data.adjustedUnitPriceCents,
        },
        actorUserId: user.id,
        relatedEntityType: "renewal_event",
        relatedEntityId: parsed.data.renewalEventId,
      });

      // Compute the savings context to return — applied OUTSIDE this
      // transaction so the savings upsert uses its own atomic block (it writes
      // its own audit entry). Under approvals-lite the savings row waits for
      // approval too: a not-yet-approved decision shouldn't show in the ledger.
      if (needsApproval) return null;

      const baseline = annualizeCents(
        sub.totalCostPerPeriodCents,
        sub.billingCycle
      );
      const kind = decisionToSavingsKind(parsed.data.decision);
      if (!kind) return null;

      let newAnnualCents: number | undefined;
      if (
        parsed.data.adjustedSeatCount !== null &&
        parsed.data.adjustedSeatCount !== undefined &&
        parsed.data.adjustedUnitPriceCents !== null &&
        parsed.data.adjustedUnitPriceCents !== undefined
      ) {
        const perPeriod =
          parsed.data.adjustedSeatCount * parsed.data.adjustedUnitPriceCents;
        newAnnualCents = annualizeCents(perPeriod, sub.billingCycle);
      }
      return {
        subscriptionId: sub.id,
        kind,
        baselineAnnualUsdCents: baseline,
        newAnnualUsdCents: newAnnualCents,
      };
    });

    // Outside the renewal-event transaction: create or update the savings row.
    // We split the transactions intentionally — a savings-row failure must NOT
    // roll back a recorded decision (the decision itself is the source of truth).
    const ctx = savingsContext;
    if (ctx) {
      try {
        await upsertSavingsRecordFromDecision({
          accountId: account.id,
          actorUserId: user.id,
          renewalEventId: parsed.data.renewalEventId,
          subscriptionId: ctx.subscriptionId,
          kind: ctx.kind,
          baselineAnnualUsdCents: ctx.baselineAnnualUsdCents,
          newAnnualUsdCents: ctx.newAnnualUsdCents,
          note: parsed.data.decisionNote,
        });
      } catch (savingsErr) {
        console.error(
          "[logRenewalDecisionAction] savings upsert failed (non-fatal):",
          savingsErr
        );
      }
    }
  } catch (err) {
    console.error("[logRenewalDecisionAction] failed:", err);
    return {
      ok: false,
      error: "Couldn't log the decision. Please try again.",
    };
  }

  revalidatePath("/notice-deadlines");
  revalidatePath("/renewals");
  revalidatePath("/dashboard");
  revalidatePath("/action-queue");
  revalidatePath("/reports");
  // Also revalidate subscription detail
  // (we don't have the subscription id directly here, so revalidate the index)
  revalidatePath("/subscriptions");

  return { ok: true };
}

/**
 * Map renewal decision → savings kind.
 *
 *   cancelled                 → cancelled
 *   downgraded                → downgraded
 *   renewed_with_adjustments  → renegotiated
 *   renewed                   → null (no savings; flat renewal)
 *   deferred                  → null (no decision yet)
 *
 * `avoided_increase` is reserved for explicit user input from the savings UI
 * — it can't be inferred from a renewal decision alone.
 */
function decisionToSavingsKind(decision: DecisionType): SavingsKind | null {
  switch (decision) {
    case "cancelled":
      return "cancelled";
    case "downgraded":
      return "downgraded";
    case "renewed_with_adjustments":
      return "renegotiated";
    case "renewed":
      return null;
  }
}

export type { DecisionType };
