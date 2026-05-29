"use server";

/**
 * Wedge PoC — generate a Renewal Intelligence Brief for a subscription.
 * Literal filename `actions.ts` so both the RBAC + audit coverage fuses see
 * it. RBAC: member+. The application module owns the audit write — this action
 * must NOT double-audit.
 */
import { revalidatePath } from "next/cache";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  requireTierFeature,
  TierFeatureDeniedError,
} from "@server/domain/billing/tier-features";
import {
  getRateLimit,
  BRIEF_GENERATION_POLICY,
} from "@server/infrastructure/rate-limit";
import {
  generateAndStoreBrief,
  RenewalBriefError,
} from "@server/application/renewal-brief";
import {
  generateAndStoreNoticeDraft,
  updateNoticeDraftBody,
  RenewalNoticeError,
} from "@server/application/renewal-notice";

export type GenerateBriefResult = { ok: true } | { ok: false; error: string };

export async function generateBriefAction(
  subscriptionId: string
): Promise<GenerateBriefResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
    // The brief is the premium AI-reasoned output — gate it (REV-1).
    requireTierFeature(account.planTier, "renewalBrief");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TierFeatureDeniedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  // Throttle per account+subscription so "Regenerate" can't be looped to stack
  // briefs / burn LLM tokens (REV-3). Server-side — the client pending flag is
  // not a control.
  const rl = await getRateLimit().check(
    `brief:${account.id}:${subscriptionId}`,
    BRIEF_GENERATION_POLICY
  );
  if (!rl.allowed) {
    return {
      ok: false,
      error: `Too many brief generations — try again in ${Math.ceil(rl.resetSeconds / 60)} min.`,
    };
  }
  try {
    await generateAndStoreBrief({
      accountId: account.id,
      subscriptionId,
      actorUserId: user.id,
    });
    revalidatePath(`/subscriptions/${subscriptionId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof RenewalBriefError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Server error" };
  }
}

export type NoticeActionResult = { ok: true } | { ok: false; error: string };

/** A3 — generate the safe-agent INTERNAL renewal-notice draft from the latest
 *  brief. Gated on renewalBrief (it's composed from that paid output). */
export async function draftInternalNoticeAction(
  subscriptionId: string
): Promise<NoticeActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
    requireTierFeature(account.planTier, "renewalBrief");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TierFeatureDeniedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  try {
    await generateAndStoreNoticeDraft({
      accountId: account.id,
      subscriptionId,
      actorUserId: user.id,
    });
    revalidatePath(`/subscriptions/${subscriptionId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof RenewalNoticeError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Server error" };
  }
}

/** A3 — save the human's edits to a notice draft (status flips to 'edited'). */
export async function saveInternalNoticeAction(input: {
  subscriptionId: string;
  draftId: string;
  subject: string;
  bodyText: string;
}): Promise<NoticeActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
    requireTierFeature(account.planTier, "renewalBrief");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TierFeatureDeniedError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  try {
    await updateNoticeDraftBody({
      accountId: account.id,
      draftId: input.draftId,
      actorUserId: user.id,
      subject: input.subject,
      bodyText: input.bodyText,
    });
    revalidatePath(`/subscriptions/${input.subscriptionId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof RenewalNoticeError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Server error" };
  }
}
