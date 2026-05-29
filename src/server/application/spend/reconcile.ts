/**
 * Wedge PoC — reconcile a detected recurring charge into the inventory.
 * Invoked ONLY at human-confirm (advisor, never agent — the detector/cron
 * never call this). Reuses the existing CSV match/dedup + draft path; adds no
 * new normalizer or charges table.
 *
 * [C4] Nested-transaction ordering: `updateSubscription` / `createSubscriptionDraft`
 * each open their OWN db.transaction. Under the max:1 pool, nesting them inside
 * our outer tx deadlocks. So we call them FIRST (top-level), capture the
 * subscriptionId, THEN flip recurring_charge + write our audit in one tx.
 * Worst case = a created/updated sub with a still-`detected`, unlinked charge;
 * re-confirm is idempotent.
 *
 * [H1] Two-key match: canonical normalizeVendorName(vendor.name) first, raw
 * subscriptionMatchKey grain second — so the aggressive feed key still matches
 * the existing trim+lowercase dedup grain.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  recurringChargesTable,
  subscriptionsTable,
  vendorsTable,
  type RecurringCharge,
  type Subscription,
} from "@server/infrastructure/db/schema";
import { normalizeVendorName } from "@server/application/vendor-benchmarks/normalize";
import { subscriptionMatchKey } from "@server/infrastructure/db/repositories/subscriptions";
import {
  createSubscriptionDraft,
  updateSubscription,
} from "@server/application/subscriptions";
import { annualizeCents } from "@server/domain/billing/annualize";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";

export class ReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconcileError";
  }
}

/**
 * The inventory stores costs in USD-typed columns (unitPriceCents,
 * totalCostPerPeriodCents). A detected charge in another currency cannot be
 * written into those columns without FX conversion — doing so would silently
 * mis-state the cost (EDGE-2). Until conversion lands we refuse, with a message
 * the human reviewer sees, so the only paths that write a charge's amount
 * (create-draft, match+apply-price) stay currency-safe. A plain link-only match
 * never writes the amount, so it is allowed for any currency.
 */
function assertReconcilableCurrency(charge: RecurringCharge): void {
  if (charge.currency !== "USD") {
    throw new ReconcileError(
      `This charge is in ${charge.currency}. Renewal Radar doesn't convert ` +
        `currencies yet — add it manually with the USD amount, or dismiss it.`
    );
  }
}

async function loadDetected(
  accountId: string,
  recurringChargeId: string
): Promise<RecurringCharge> {
  const [row] = await db
    .select()
    .from(recurringChargesTable)
    .where(
      and(
        eq(recurringChargesTable.id, recurringChargeId),
        eq(recurringChargesTable.accountId, accountId)
      )
    )
    .limit(1);
  if (!row) throw new ReconcileError("Recurring charge not found in this account.");
  if (row.status !== "detected") {
    throw new ReconcileError(
      `This suggestion is already ${row.status} — refresh and try again.`
    );
  }
  return row;
}

/**
 * Find an existing subscription that this charge likely already represents,
 * using the two-key lookup. Returns null when there's no confident match.
 */
export async function findMatchingSubscription(
  accountId: string,
  charge: Pick<RecurringCharge, "normalizedMerchant" | "suggestedVendorName">,
  productName?: string
): Promise<Subscription | null> {
  const rows = await db
    .select({ sub: subscriptionsTable, vendorName: vendorsTable.name })
    .from(subscriptionsTable)
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(subscriptionsTable.accountId, accountId),
        ne(subscriptionsTable.status, "cancelled")
      )
    );

  // Key 1 — canonical.
  for (const r of rows) {
    if (normalizeVendorName(r.vendorName) === charge.normalizedMerchant) {
      return r.sub;
    }
  }
  // Key 2 — the existing trim+lowercase dedup grain.
  const product = productName ?? charge.suggestedVendorName;
  const wantKey = subscriptionMatchKey(charge.suggestedVendorName, product);
  for (const r of rows) {
    if (subscriptionMatchKey(r.vendorName, r.sub.productName) === wantKey) {
      return r.sub;
    }
  }
  return null;
}

export type ReconcileResult = {
  recurringCharge: RecurringCharge;
  subscriptionId: string | null;
  outcome: "matched_existing" | "created_draft" | "dismissed";
};

/** Link a detected charge to an existing subscription (optionally applying the
 *  observed price through the existing updateSubscription machinery). */
export async function confirmRecurringChargeAsMatch(input: {
  accountId: string;
  recurringChargeId: string;
  actorUserId: string;
  applyObservedPrice: boolean;
}): Promise<ReconcileResult> {
  const charge = await loadDetected(input.accountId, input.recurringChargeId);
  const match = await findMatchingSubscription(input.accountId, charge);
  if (!match) {
    throw new ReconcileError(
      "No matching subscription found — create a draft instead."
    );
  }

  // Only applying the observed price writes the charge amount into USD columns;
  // a plain link is currency-agnostic. Guard the price-writing path only.
  if (input.applyObservedPrice) assertReconcilableCurrency(charge);

  // [C4] call updateSubscription FIRST (it owns its own tx + audit + price_changed).
  if (input.applyObservedPrice) {
    await updateSubscription({
      accountId: input.accountId,
      subscriptionId: match.id,
      actorUserId: input.actorUserId,
      patch: {
        unitPriceCents: charge.latestAmountCents,
        billingCycle: charge.detectedCycle,
      },
    });
  }

  const updated = await flipConfirmed({
    accountId: input.accountId,
    actorUserId: input.actorUserId,
    chargeId: charge.id,
    subscriptionId: match.id,
    outcome: "matched_existing",
    appliedPrice: input.applyObservedPrice,
  });
  return { recurringCharge: updated, subscriptionId: match.id, outcome: "matched_existing" };
}

/** Create a draft subscription from the suggestion (vendor + cadence + amount;
 *  no term dates → draft, never an active sub that would fire bogus alerts). */
export async function confirmRecurringChargeAsDraft(input: {
  accountId: string;
  recurringChargeId: string;
  actorUserId: string;
  productName?: string;
}): Promise<ReconcileResult> {
  const charge = await loadDetected(input.accountId, input.recurringChargeId);
  // A draft writes annualizeCents(charge.typicalAmountCents) into a USD column.
  assertReconcilableCurrency(charge);

  // [C4] createSubscriptionDraft FIRST (owns its own tx + audit).
  const draft = await createSubscriptionDraft({
    accountId: input.accountId,
    actorUserId: input.actorUserId,
    vendorName: charge.suggestedVendorName,
    productName: input.productName?.trim() || charge.suggestedVendorName,
    annualizedUsdCents: annualizeCents(charge.typicalAmountCents, charge.detectedCycle),
    notes: `Auto-detected from spend feed — ${charge.sampleSize} charges, ${charge.detectedCycle}, ~${charge.typicalAmountCents / 100} ${charge.currency}/period.`,
  });

  const updated = await flipConfirmed({
    accountId: input.accountId,
    actorUserId: input.actorUserId,
    chargeId: charge.id,
    subscriptionId: draft.id,
    outcome: "created_draft",
    appliedPrice: false,
  });
  return { recurringCharge: updated, subscriptionId: draft.id, outcome: "created_draft" };
}

/** Dismiss a suggestion ("not a subscription"). */
export async function dismissRecurringCharge(input: {
  accountId: string;
  recurringChargeId: string;
  actorUserId: string;
}): Promise<ReconcileResult> {
  const charge = await loadDetected(input.accountId, input.recurringChargeId);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(recurringChargesTable)
      .set({
        status: "dismissed",
        reviewedByUserId: input.actorUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recurringChargesTable.id, charge.id),
          eq(recurringChargesTable.accountId, input.accountId),
          eq(recurringChargesTable.status, "detected")
        )
      )
      .returning();
    if (!row) throw new ReconcileError("Suggestion changed — refresh and try again.");
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.recurringChargeDismissed,
      target: { entityType: "recurring_charge", entityId: row.id },
      after: { merchant: row.suggestedVendorName },
    });
    return row;
  });
  return { recurringCharge: updated, subscriptionId: null, outcome: "dismissed" };
}

/** Shared confirmed-flip + audit (the apply-price / create-draft branches must
 *  NOT double-audit — the subscription mutation already wrote its own log). */
async function flipConfirmed(input: {
  accountId: string;
  actorUserId: string;
  chargeId: string;
  subscriptionId: string;
  outcome: "matched_existing" | "created_draft";
  appliedPrice: boolean;
}): Promise<RecurringCharge> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(recurringChargesTable)
      .set({
        status: "confirmed",
        subscriptionId: input.subscriptionId,
        reconciliationOutcome: input.outcome,
        reviewedByUserId: input.actorUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recurringChargesTable.id, input.chargeId),
          eq(recurringChargesTable.accountId, input.accountId),
          eq(recurringChargesTable.status, "detected")
        )
      )
      .returning();
    if (!row) throw new ReconcileError("Suggestion changed — refresh and try again.");
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.recurringChargeConfirmed,
      target: { entityType: "recurring_charge", entityId: row.id },
      after: {
        outcome: input.outcome,
        subscriptionId: input.subscriptionId,
        appliedPrice: input.appliedPrice,
      },
    });
    return row;
  });
}
