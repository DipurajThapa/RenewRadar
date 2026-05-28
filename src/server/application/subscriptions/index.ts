import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type {
  NewSubscription,
  Subscription,
  Vendor,
} from "@server/infrastructure/db/schema";
import { calculateNoticeDeadline } from "@server/domain/notice-deadline/calculate";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";

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
  });
}
