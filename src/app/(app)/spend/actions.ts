"use server";

/**
 * Wedge PoC — spend ingestion + recurring-charge review actions.
 * Every action gates on `requireRole(user, "member")` (the RBAC fuse).
 * Confirm/dismiss audit through the application modules.
 */
import { revalidatePath } from "next/cache";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  AccountLockedError,
  requireAccountWritable,
} from "@server/application/billing/lock-state";
import { SubscriptionLimitError } from "@server/application/subscriptions";
import {
  requireTierFeature,
  TierFeatureDeniedError,
} from "@server/domain/billing/tier-features";
import { getRateLimit, SPEND_SYNC_POLICY } from "@server/infrastructure/rate-limit";
import {
  upsertSpendConnection,
} from "@server/application/spend/connections";
import { ingestSpendConnection } from "@server/application/spend/ingest";
import { detectRecurringForConnection } from "@server/application/spend/detect";
import {
  confirmRecurringChargeAsDraft,
  confirmRecurringChargeAsMatch,
  dismissRecurringCharge,
  findMatchingSubscription,
  ReconcileError,
} from "@server/application/spend/reconcile";
import {
  getRecurringCharge,
  getSpendConnectionByKind,
} from "@server/infrastructure/db/repositories/spend";

export type SpendActionResult = { ok: true } | { ok: false; error: string };

/**
 * Connect the (fixture) spend feed and immediately sync + detect, so the demo
 * inventory populates in one click. The Ramp path swaps in when keys land.
 */
export async function connectSpendFeedAction(): Promise<SpendActionResult> {
  let ctx: Awaited<ReturnType<typeof getCurrentAccountAndUser>>;
  try {
    ctx = await getCurrentAccountAndUser();
    requireRole(ctx.user, "member");
    requireTierFeature(ctx.account.planTier, "spendAutoDiscovery");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TierFeatureDeniedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  try {
    await upsertSpendConnection({
      accountId: ctx.account.id,
      actorUserId: ctx.user.id,
      kind: "fixture",
      config: { datasetId: "default" },
    });
    const connection = await getSpendConnectionByKind(ctx.account.id, "fixture");
    if (connection) {
      await ingestSpendConnection(connection);
      await detectRecurringForConnection({
        accountId: ctx.account.id,
        connectionId: connection.id,
      });
    }
    revalidatePath("/spend");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Server error" };
  }
}

/** Re-run sync + detection on demand (the cron does this daily). */
export async function syncSpendFeedAction(): Promise<SpendActionResult> {
  let ctx: Awaited<ReturnType<typeof getCurrentAccountAndUser>>;
  try {
    ctx = await getCurrentAccountAndUser();
    requireRole(ctx.user, "member");
    requireTierFeature(ctx.account.planTier, "spendAutoDiscovery");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TierFeatureDeniedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  // Throttle the manual "Sync now" button so ingest+detect can't be hammered in
  // a loop (the daily cron does the routine work). Per-account window.
  const rl = await getRateLimit().check(
    `spend-sync:${ctx.account.id}`,
    SPEND_SYNC_POLICY
  );
  if (!rl.allowed) {
    return {
      ok: false,
      error: `Too many syncs — try again in ${Math.ceil(rl.resetSeconds / 60)} min.`,
    };
  }
  const connection = await getSpendConnectionByKind(ctx.account.id, "fixture");
  if (!connection) return { ok: false, error: "No spend feed connected." };
  await ingestSpendConnection(connection);
  await detectRecurringForConnection({
    accountId: ctx.account.id,
    connectionId: connection.id,
  });
  revalidatePath("/spend");
  return { ok: true };
}

export type ConfirmMode = "match" | "match_apply_price" | "create_draft" | "dismiss";

export async function reviewRecurringChargeAction(input: {
  recurringChargeId: string;
  mode: ConfirmMode;
  productName?: string | null;
}): Promise<SpendActionResult> {
  let ctx: Awaited<ReturnType<typeof getCurrentAccountAndUser>>;
  try {
    ctx = await getCurrentAccountAndUser();
    requireRole(ctx.user, "member");
    requireTierFeature(ctx.account.planTier, "spendAutoDiscovery");
    // Every mode except "dismiss" mutates inventory (creates a draft, links a
    // sub, or applies a price) — refuse those when the account is over-capacity
    // locked. Dismiss only clears a suggestion, so it stays allowed.
    if (input.mode !== "dismiss") requireAccountWritable(ctx.account);
  } catch (err) {
    if (
      err instanceof ForbiddenError ||
      err instanceof AccountLockedError ||
      err instanceof TierFeatureDeniedError
    ) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  try {
    const base = {
      accountId: ctx.account.id,
      recurringChargeId: input.recurringChargeId,
      actorUserId: ctx.user.id,
    };
    if (input.mode === "dismiss") {
      await dismissRecurringCharge(base);
    } else if (input.mode === "create_draft") {
      await confirmRecurringChargeAsDraft({
        ...base,
        productName: input.productName ?? undefined,
      });
    } else {
      await confirmRecurringChargeAsMatch({
        ...base,
        applyObservedPrice: input.mode === "match_apply_price",
      });
    }
    revalidatePath("/spend");
    revalidatePath("/subscriptions");
    return { ok: true };
  } catch (err) {
    // SubscriptionLimitError bubbles up from createSubscriptionDraft when
    // confirming-as-draft would exceed the plan cap (the spend-feed bypass).
    if (err instanceof ReconcileError || err instanceof SubscriptionLimitError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Server error" };
  }
}

/** Whether a detected charge has a likely existing-subscription match — drives
 *  whether the review UI shows "Match" vs "Create draft". */
export async function recurringChargeHasMatchAction(
  recurringChargeId: string
): Promise<{ ok: true; hasMatch: boolean } | { ok: false; error: string }> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  const charge = await getRecurringCharge(account.id, recurringChargeId);
  if (!charge) return { ok: false, error: "Not found" };
  const match = await findMatchingSubscription(account.id, charge);
  return { ok: true, hasMatch: match !== null };
}
