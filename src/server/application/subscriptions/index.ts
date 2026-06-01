import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type {
  NewSubscription,
  RenewalItemCategory,
  Subscription,
  Vendor,
} from "@server/infrastructure/db/schema";
import { calculateNoticeDeadline } from "@server/domain/notice-deadline/calculate";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";
import { recordEvent } from "@server/infrastructure/analytics";
import {
  TIER_DEFINITIONS,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";
import { requireAccountWritable } from "@server/application/billing/lock-state";
import { countSubscriptionsTowardCap } from "@server/infrastructure/db/repositories/subscriptions";

/**
 * Thrown when creating a subscription would exceed the account's plan cap.
 * Carries a human-readable upgrade nudge as its message so server actions can
 * surface it directly. Distinct from AccountLockedError (over-capacity lock).
 */
export class SubscriptionLimitError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Plan limit reached (${limit} subscriptions). Upgrade to add another.`);
    this.name = "SubscriptionLimitError";
    this.limit = limit;
  }
}

/**
 * Single chokepoint for "may this account take on another subscription?" —
 * enforces BOTH the over-capacity write lock and the plan subscription cap
 * (drafts included, via countSubscriptionsTowardCap). Called by every create
 * path (manual quick-add, starter templates, intake approval, spend-feed
 * confirm) so no surface can bypass the cap. Throws AccountLockedError or
 * SubscriptionLimitError.
 */
export async function assertCanCreateSubscription(
  accountId: string
): Promise<void> {
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId))
    .limit(1);
  if (!account) throw new Error("Account not found");
  requireAccountWritable(account);
  const cap = TIER_DEFINITIONS[account.planTier as PlanTier].limits.maxSubscriptions;
  if (Number.isFinite(cap)) {
    const used = await countSubscriptionsTowardCap(accountId);
    if (used >= cap) throw new SubscriptionLimitError(cap);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find a vendor by name in the account or create one. Case-insensitive match.
 * Used by the inline "type vendor name" pattern on the subscription form.
 */
export async function ensureVendor(input: {
  accountId: string;
  name: string;
}): Promise<Vendor> {
  const trimmed = input.name.trim();
  if (!trimmed) {
    throw new Error("Vendor name is required");
  }

  // Case-insensitive lookup within the account. At V1 scale (≤200 vendors
  // per account) the in-memory filter is fine; revisit if accounts grow.
  const accountVendors = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.accountId, input.accountId));
  const found = accountVendors.find(
    (v) => v.name.toLowerCase() === trimmed.toLowerCase()
  );

  if (found) return found;

  const [created] = await db
    .insert(vendorsTable)
    .values({
      accountId: input.accountId,
      name: trimmed,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create vendor");
  }
  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create subscription (with renewal event + audit log, in one transaction)
// ─────────────────────────────────────────────────────────────────────────────

export async function createSubscriptionWithRenewalEvent(input: {
  accountId: string;
  vendorId: string;
  actorUserId: string;
  /** Owner of the subscription. Defaults to the actor when omitted. */
  ownerUserId?: string | null;
  data: Omit<
    NewSubscription,
    | "id"
    | "accountId"
    | "vendorId"
    | "ownerUserId"
    | "createdAt"
    | "updatedAt"
    | "totalCostPerPeriodCents"
  >;
}): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const unitPriceCents = input.data.unitPriceCents;
    const totalSeats = input.data.totalSeats ?? 1;
    const totalCostPerPeriodCents = unitPriceCents * totalSeats;

    const [subscription] = await tx
      .insert(subscriptionsTable)
      .values({
        accountId: input.accountId,
        vendorId: input.vendorId,
        // Caller-provided owner takes precedence; falls back to the actor so
        // "the user who added it" is the implicit default — never null on create.
        ownerUserId: input.ownerUserId ?? input.actorUserId,
        ...input.data,
        totalSeats,
        totalCostPerPeriodCents,
      })
      .returning();

    if (!subscription) {
      throw new Error("Failed to create subscription");
    }

    // Emit the renewal event for the current term
    const noticeDeadline = calculateNoticeDeadline(
      subscription.termEndDate,
      subscription.noticePeriodDays
    );

    await tx.insert(renewalEventsTable).values({
      subscriptionId: subscription.id,
      accountId: input.accountId,
      renewalDate: subscription.termEndDate,
      noticeDeadline: noticeDeadline.toISOString().split("T")[0]!,
      status: "upcoming",
    });

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.subscriptionCreated,
      target: { entityType: "subscription", entityId: subscription.id },
      after: subscription as unknown as Record<string, unknown>,
    });

    // Vendor memory: this subscription becomes part of the vendor relationship
    // timeline forever. Snapshot the initial terms so a future operator can
    // reconstruct "what did we sign for the first time."
    await recordVendorEvent(tx, {
      accountId: input.accountId,
      vendorId: input.vendorId,
      subscriptionId: subscription.id,
      kind: "subscription_created",
      payload: {
        productName: subscription.productName,
        planName: subscription.planName,
        billingCycle: subscription.billingCycle,
        termStartDate: subscription.termStartDate,
        termEndDate: subscription.termEndDate,
        totalSeats: subscription.totalSeats,
        unitPriceCents: subscription.unitPriceCents,
        totalCostPerPeriodCents: subscription.totalCostPerPeriodCents,
        autoRenew: subscription.autoRenew,
        noticePeriodDays: subscription.noticePeriodDays,
      },
      actorUserId: input.actorUserId,
      relatedEntityType: "subscription",
      relatedEntityId: subscription.id,
    });

    // Activation funnel: adding the first subscription (with or without a
    // contract upload) is the user committing to the product. We fire here
    // — fire-and-forget so the create path stays atomic from the user's
    // perspective even if analytics is slow.
    void recordEvent({
      event: "subscription.created",
      context: {
        accountId: input.accountId,
        userId: input.actorUserId,
      },
      properties: {
        subscriptionId: subscription.id,
        vendorId: subscription.vendorId,
        billingCycle: subscription.billingCycle,
        totalCostPerPeriodCents: subscription.totalCostPerPeriodCents,
        autoRenew: subscription.autoRenew,
        noticePeriodDays: subscription.noticePeriodDays,
      },
    });

    return subscription;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// T2.7 — Create subscription DRAFT (minimal data, no renewal event, no alerts)
// ─────────────────────────────────────────────────────────────────────────────

export type CreateDraftInput = {
  accountId: string;
  actorUserId: string;
  vendorName: string;
  productName: string;
  /** Estimated annualized cost in cents. Stored as totalCostPerPeriodCents
   *  with billing_cycle=annual so existing reports treat it sanely. */
  annualizedUsdCents: number;
  notes?: string | null;
  /** Obligation type — defaults to saas_subscription so existing callers are
   *  unaffected; non-SaaS intake (a license, an insurance policy, a notice)
   *  rides the same draft path by passing a category + type-specific attributes. */
  category?: RenewalItemCategory;
  attributes?: Record<string, unknown>;
};

/**
 * Create a draft subscription — captures vendor + product + estimated annual
 * cost so a user can record "we pay for X" without having the contract terms
 * in hand. Drafts:
 *
 *   - Set `status = 'draft'` so every "show me active subscriptions" query
 *     (alerts, action queue, KPIs, reports) automatically excludes them.
 *     The active-status filter is the single point of truth across 20+
 *     repository queries — see [audit gap T2.7] for the grep.
 *   - Do NOT create a renewal_event row. We don't know term_end yet, and
 *     making one up would either fire bogus alerts or pollute the action
 *     queue with "fix me" placeholders. The user promotes the draft to
 *     active via the regular edit flow which fills in term dates and
 *     creates the renewal_event lazily.
 *   - Use placeholder term dates (today and today+365) so date columns
 *     stay non-null per the schema. These dates are NEVER read for alerts
 *     because the status filter excludes drafts first.
 *   - Vendor row IS created (via ensureVendor) — vendor list is the user's
 *     mental map of "what we pay for" and the draft belongs in it.
 *
 * The user promotes a draft → active by editing the subscription with
 * full term details. That path is the existing updateSubscription flow.
 */
export async function createSubscriptionDraft(
  input: CreateDraftInput
): Promise<Subscription> {
  if (!input.vendorName.trim()) {
    throw new Error("Vendor name is required");
  }
  if (!input.productName.trim()) {
    throw new Error("Product name is required");
  }
  if (
    !Number.isFinite(input.annualizedUsdCents) ||
    input.annualizedUsdCents < 0
  ) {
    throw new Error("Annualized cost must be a non-negative number");
  }

  // Gate EVERY draft create (manual quick-add, starter templates, intake
  // approval, spend-feed confirm) on the over-capacity lock + plan cap. This is
  // the single chokepoint — closes the cap bypass where confirming many
  // auto-detected charges as drafts could exceed the plan limit (REV-4).
  await assertCanCreateSubscription(input.accountId);

  return db.transaction(async (tx) => {
    // ensureVendor is account-scoped + case-insensitive; calling it inside
    // the tx keeps the vendor + sub create atomic.
    const trimmedVendor = input.vendorName.trim();
    const accountVendors = await tx
      .select()
      .from(vendorsTable)
      .where(eq(vendorsTable.accountId, input.accountId));
    let vendor = accountVendors.find(
      (v) => v.name.toLowerCase() === trimmedVendor.toLowerCase()
    );
    if (!vendor) {
      const [created] = await tx
        .insert(vendorsTable)
        .values({ accountId: input.accountId, name: trimmedVendor })
        .returning();
      if (!created) throw new Error("Failed to create vendor for draft");
      vendor = created;
    }

    // Placeholder term dates. These are NEVER read by alerts because the
    // status filter on `subscriptions.status = 'active'` excludes drafts
    // up front. When the user promotes the draft, they pick real dates
    // through the normal edit form and the renewal event is created then.
    const todayUtc = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate()
      )
    );
    const placeholderEnd = new Date(todayUtc);
    placeholderEnd.setUTCDate(placeholderEnd.getUTCDate() + 365);

    const [subscription] = await tx
      .insert(subscriptionsTable)
      .values({
        accountId: input.accountId,
        vendorId: vendor.id,
        ownerUserId: input.actorUserId,
        category: input.category ?? "saas_subscription",
        attributesJson: input.attributes ?? {},
        productName: input.productName.trim(),
        planName: null,
        billingCycle: "annual" as const,
        termStartDate: todayUtc.toISOString().split("T")[0]!,
        termEndDate: placeholderEnd.toISOString().split("T")[0]!,
        autoRenew: true,
        noticePeriodDays: 30,
        totalSeats: 1,
        unitPriceCents: input.annualizedUsdCents,
        totalCostPerPeriodCents: input.annualizedUsdCents,
        status: "draft" as const,
        notes: input.notes ?? null,
      })
      .returning();

    if (!subscription) {
      throw new Error("Failed to create draft subscription");
    }

    // Audit-log the draft creation so it appears in the activity log
    // even though we don't fire renewal/vendor events. Operators searching
    // for "where did this come from?" will find it.
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.subscriptionCreated,
      target: { entityType: "subscription", entityId: subscription.id },
      after: {
        kind: "draft",
        vendorName: trimmedVendor,
        productName: subscription.productName,
        annualizedUsdCents: input.annualizedUsdCents,
      },
    });

    return subscription;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Update subscription (recalculate notice deadline if term/notice changed)
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateSubscriptionPatch = Partial<
  Omit<
    Subscription,
    | "id"
    | "accountId"
    | "vendorId"
    | "createdAt"
    | "updatedAt"
    | "totalCostPerPeriodCents"
  >
>;

export async function updateSubscription(input: {
  accountId: string;
  subscriptionId: string;
  actorUserId: string;
  patch: UpdateSubscriptionPatch;
}): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, input.subscriptionId));

    if (!before || before.accountId !== input.accountId) {
      throw new Error("Subscription not found");
    }

    // Recompute totalCostPerPeriodCents if pricing or seats changed
    const newUnitPrice =
      input.patch.unitPriceCents ?? before.unitPriceCents;
    const newTotalSeats = input.patch.totalSeats ?? before.totalSeats;
    const newTotalCost = newUnitPrice * newTotalSeats;

    const setValues = {
      ...input.patch,
      totalCostPerPeriodCents: newTotalCost,
    };

    const [updated] = await tx
      .update(subscriptionsTable)
      .set(setValues)
      .where(eq(subscriptionsTable.id, input.subscriptionId))
      .returning();

    if (!updated) {
      throw new Error("Failed to update subscription");
    }

    // If term_end or notice_period changed, recalculate the renewal event
    const termOrNoticeChanged =
      ("termEndDate" in input.patch &&
        input.patch.termEndDate !== before.termEndDate) ||
      ("noticePeriodDays" in input.patch &&
        input.patch.noticePeriodDays !== before.noticePeriodDays);

    if (termOrNoticeChanged) {
      const noticeDeadline = calculateNoticeDeadline(
        updated.termEndDate,
        updated.noticePeriodDays
      );

      await tx
        .update(renewalEventsTable)
        .set({
          renewalDate: updated.termEndDate,
          noticeDeadline: noticeDeadline.toISOString().split("T")[0]!,
          // Reset status: a moved deadline may no longer be in the alert window
          status: "upcoming",
        })
        .where(eq(renewalEventsTable.subscriptionId, updated.id));
    }

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.subscriptionUpdated,
      target: { entityType: "subscription", entityId: updated.id },
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    // Vendor memory: capture a structured diff of business-relevant fields
    // so the timeline shows "what changed" without forcing the UI to diff
    // two JSON blobs.
    const watched: (keyof Subscription)[] = [
      "productName",
      "planName",
      "billingCycle",
      "termStartDate",
      "termEndDate",
      "autoRenew",
      "noticePeriodDays",
      "totalSeats",
      "unitPriceCents",
      "totalCostPerPeriodCents",
      "status",
      "ownerUserId",
    ];
    const changes = watched
      .filter((k) => before[k] !== updated[k])
      .map((k) => ({
        field: k,
        before: before[k] as unknown,
        after: updated[k] as unknown,
      }));
    if (changes.length > 0) {
      await recordVendorEvent(tx, {
        accountId: input.accountId,
        vendorId: updated.vendorId,
        subscriptionId: updated.id,
        kind: "subscription_updated",
        payload: { changes },
        actorUserId: input.actorUserId,
        relatedEntityType: "subscription",
        relatedEntityId: updated.id,
      });

      // Specialized events for the two most consequential trends: price
      // changes and seat count changes. Lets the intelligence view answer
      // "what's the price trajectory?" with a clean query rather than
      // walking every subscription_updated payload.
      if (before.unitPriceCents !== updated.unitPriceCents) {
        const before100 = before.totalCostPerPeriodCents || 1;
        const delta =
          ((updated.totalCostPerPeriodCents - before.totalCostPerPeriodCents) /
            before100) *
          100;
        await recordVendorEvent(tx, {
          accountId: input.accountId,
          vendorId: updated.vendorId,
          subscriptionId: updated.id,
          kind: "price_changed",
          payload: {
            beforeUnitPriceCents: before.unitPriceCents,
            afterUnitPriceCents: updated.unitPriceCents,
            beforeTotalCostPerPeriodCents: before.totalCostPerPeriodCents,
            afterTotalCostPerPeriodCents: updated.totalCostPerPeriodCents,
            deltaPct: Number(delta.toFixed(2)),
          },
          actorUserId: input.actorUserId,
        });
      }
      if (before.totalSeats !== updated.totalSeats) {
        await recordVendorEvent(tx, {
          accountId: input.accountId,
          vendorId: updated.vendorId,
          subscriptionId: updated.id,
          kind: "seat_count_changed",
          payload: {
            beforeSeats: before.totalSeats,
            afterSeats: updated.totalSeats,
            deltaSeats: updated.totalSeats - before.totalSeats,
          },
          actorUserId: input.actorUserId,
        });
      }
      if (before.ownerUserId !== updated.ownerUserId) {
        await recordVendorEvent(tx, {
          accountId: input.accountId,
          vendorId: updated.vendorId,
          subscriptionId: updated.id,
          kind: "owner_changed",
          payload: {
            beforeOwnerUserId: before.ownerUserId,
            afterOwnerUserId: updated.ownerUserId,
          },
          actorUserId: input.actorUserId,
        });
      }
    }

    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft delete (status → cancelled)
// ─────────────────────────────────────────────────────────────────────────────

export async function softDeleteSubscription(input: {
  accountId: string;
  subscriptionId: string;
  actorUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, input.subscriptionId));

    if (!before || before.accountId !== input.accountId) {
      throw new Error("Subscription not found");
    }

    await tx
      .update(subscriptionsTable)
      .set({ status: "cancelled" })
      .where(eq(subscriptionsTable.id, input.subscriptionId));

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.subscriptionCancelled,
      target: { entityType: "subscription", entityId: input.subscriptionId },
      before: before as unknown as Record<string, unknown>,
    });

    await recordVendorEvent(tx, {
      accountId: input.accountId,
      vendorId: before.vendorId,
      subscriptionId: before.id,
      kind: "subscription_cancelled",
      payload: {
        productName: before.productName,
        termEndDate: before.termEndDate,
      },
      actorUserId: input.actorUserId,
      relatedEntityType: "subscription",
      relatedEntityId: before.id,
    });
  });
}
