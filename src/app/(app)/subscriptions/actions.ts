"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  createSubscriptionSchema,
  dollarsToCents,
  updateSubscriptionSchema,
} from "@shared/validation/subscription";
import {
  createSubscriptionWithRenewalEvent,
  ensureVendor,
  softDeleteSubscription,
  updateSubscription,
} from "@server/application/subscriptions";
import { countActiveSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import { userBelongsToAccount } from "@server/infrastructure/db/repositories/users";
import { PLAN_LIMITS } from "@server/infrastructure/billing/plans";

export type ActionResult =
  | { ok: true; subscriptionId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string[]> };

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export async function createSubscriptionAction(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  // Free Forever cap check BEFORE validation — fast bail
  const planLimit = PLAN_LIMITS[account.planTier]?.maxSubscriptions;
  if (planLimit !== undefined && Number.isFinite(planLimit)) {
    const existing = await countActiveSubscriptions(account.id);
    if (existing >= planLimit) {
      return {
        ok: false,
        formError: `You've reached the ${planLimit}-subscription limit on ${formatTier(
          account.planTier
        )}. Upgrade to add more.`,
      };
    }
  }

  const unitPriceCents = dollarsToCents(formData.get("unitPriceDollars"));
  if (unitPriceCents === null) {
    return {
      ok: false,
      fieldErrors: { unitPriceCents: ["Enter a valid price"] },
    };
  }

  const parsed = createSubscriptionSchema.safeParse({
    vendorName: formData.get("vendorName"),
    productName: formData.get("productName"),
    planName: emptyToNull(formData.get("planName")),
    billingCycle: formData.get("billingCycle"),
    termStartDate: formData.get("termStartDate"),
    termEndDate: formData.get("termEndDate"),
    autoRenew: formData.get("autoRenew") === "on",
    noticePeriodDays: formData.get("noticePeriodDays") ?? 30,
    totalSeats: formData.get("totalSeats") ?? 1,
    unitPriceCents,
    notes: emptyToNull(formData.get("notes")),
    ownerUserId: emptyToNull(formData.get("ownerUserId")),
  });

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;

  // Defense-in-depth: the dropdown is server-rendered with this account's users
  // only, but a crafted POST could submit any UUID. Reject anything that
  // doesn't belong to the current account.
  let ownerUserId: string | null = data.ownerUserId ?? user.id; // default to current user
  if (data.ownerUserId) {
    const ok = await userBelongsToAccount(account.id, data.ownerUserId);
    if (!ok) {
      return {
        ok: false,
        fieldErrors: { ownerUserId: ["Owner must be a member of this account"] },
      };
    }
    ownerUserId = data.ownerUserId;
  }

  try {
    const vendor = await ensureVendor({
      accountId: account.id,
      name: data.vendorName,
    });

    const subscription = await createSubscriptionWithRenewalEvent({
      accountId: account.id,
      vendorId: vendor.id,
      actorUserId: user.id,
      ownerUserId,
      data: {
        productName: data.productName,
        planName: data.planName ?? null,
        billingCycle: data.billingCycle,
        termStartDate: data.termStartDate,
        termEndDate: data.termEndDate,
        autoRenew: data.autoRenew,
        noticePeriodDays: data.noticePeriodDays,
        totalSeats: data.totalSeats,
        unitPriceCents: data.unitPriceCents,
        status: "active",
        notes: data.notes ?? null,
      },
    });

    revalidatePath("/subscriptions");
    revalidatePath("/dashboard");
    revalidatePath("/notice-deadlines");
    revalidatePath("/renewals");

    return { ok: true, subscriptionId: subscription.id };
  } catch (err) {
    console.error("[createSubscriptionAction] failed:", err);
    return {
      ok: false,
      formError: "Something went wrong. Please try again.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────────

export async function updateSubscriptionAction(
  subscriptionId: string,
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  const unitPriceCents = dollarsToCents(formData.get("unitPriceDollars"));
  if (unitPriceCents === null) {
    return {
      ok: false,
      fieldErrors: { unitPriceCents: ["Enter a valid price"] },
    };
  }

  const parsed = updateSubscriptionSchema.safeParse({
    productName: formData.get("productName"),
    planName: emptyToNull(formData.get("planName")),
    billingCycle: formData.get("billingCycle"),
    termStartDate: formData.get("termStartDate"),
    termEndDate: formData.get("termEndDate"),
    autoRenew: formData.get("autoRenew") === "on",
    noticePeriodDays: formData.get("noticePeriodDays") ?? 30,
    totalSeats: formData.get("totalSeats") ?? 1,
    unitPriceCents,
    notes: emptyToNull(formData.get("notes")),
    ownerUserId: emptyToNull(formData.get("ownerUserId")),
  });

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Defense-in-depth: validate owner belongs to this account before saving.
  // An explicit null means "unassign".
  if (parsed.data.ownerUserId) {
    const ok = await userBelongsToAccount(account.id, parsed.data.ownerUserId);
    if (!ok) {
      return {
        ok: false,
        fieldErrors: { ownerUserId: ["Owner must be a member of this account"] },
      };
    }
  }

  try {
    await updateSubscription({
      accountId: account.id,
      subscriptionId,
      actorUserId: user.id,
      patch: parsed.data,
    });

    revalidatePath("/subscriptions");
    revalidatePath(`/subscriptions/${subscriptionId}`);
    revalidatePath("/dashboard");
    revalidatePath("/notice-deadlines");
    revalidatePath("/renewals");

    return { ok: true, subscriptionId };
  } catch (err) {
    console.error("[updateSubscriptionAction] failed:", err);
    return {
      ok: false,
      formError: "Something went wrong. Please try again.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft delete (cancel)
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteSubscriptionAction(
  subscriptionId: string
): Promise<void> {
  const { account, user } = await getCurrentAccountAndUser();
  // Throws ForbiddenError if the user is a viewer. We don't catch here —
  // delete is wrapped in a `<form>` action; an uncaught throw is rendered
  // as the framework's 500. Soft-cancel is destructive enough that a clearer
  // UX is worth a follow-up.
  requireRole(user, "member");

  await softDeleteSubscription({
    accountId: account.id,
    subscriptionId,
    actorUserId: user.id,
  });

  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/notice-deadlines");
  revalidatePath("/renewals");

  redirect("/subscriptions");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function formatTier(tier: string): string {
  return tier
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
