"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  AccountLockedError,
  requireAccountWritable,
} from "@server/application/billing/lock-state";
import { createSubscriptionDraft } from "@server/application/subscriptions";
import { countActiveSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import { PLAN_LIMITS } from "@server/infrastructure/billing/plans";
import {
  getStarterTemplate,
  type StarterTemplateProfile,
} from "@server/domain/onboarding/starter-templates";

/**
 * T3.6 — Apply a starter template.
 *
 * Creates drafts for the items the user selected. Reuses
 * `createSubscriptionDraft` so the existing audit-log + active-status
 * invariants hold automatically.
 */

export type ApplyStarterResult =
  | {
      ok: true;
      created: number;
      skipped: number;
      /** Per-item result so the UI can render checkmarks/errors. */
      results: Array<
        | { key: string; ok: true; subscriptionId: string }
        | { key: string; ok: false; error: string }
      >;
    }
  | { ok: false; formError: string };

export async function applyStarterTemplateAction(input: {
  profile: StarterTemplateProfile;
  selectedKeys: string[];
}): Promise<ApplyStarterResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
    requireAccountWritable(account);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof AccountLockedError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  const template = getStarterTemplate(input.profile);
  if (!template) {
    return { ok: false, formError: "Unknown template profile." };
  }

  const selected = template.items.filter((i) =>
    input.selectedKeys.includes(i.key)
  );
  if (selected.length === 0) {
    return {
      ok: false,
      formError: "Pick at least one row from the template.",
    };
  }

  // Plan cap pre-check — refuse the batch up front if it would push the
  // account over the subscription limit. The user can come back and pick
  // a smaller subset.
  const limit = PLAN_LIMITS[account.planTier]?.maxSubscriptions;
  if (limit !== undefined && Number.isFinite(limit)) {
    const existing = await countActiveSubscriptions(account.id);
    if (existing + selected.length > limit) {
      return {
        ok: false,
        formError: `That selection would exceed your plan limit (${limit} subscriptions). Pick a smaller subset or upgrade.`,
      };
    }
  }

  const results: Extract<ApplyStarterResult, { ok: true }>["results"] = [];
  let created = 0;
  let skipped = 0;

  for (const item of selected) {
    try {
      const sub = await createSubscriptionDraft({
        accountId: account.id,
        actorUserId: user.id,
        vendorName: item.vendor,
        productName: item.product,
        annualizedUsdCents: Math.round(item.annualUsd * 100),
        notes: `Starter template (${template.label})${item.note ? " — " + item.note : ""}`,
      });
      results.push({ key: item.key, ok: true, subscriptionId: sub.id });
      created++;
    } catch (err) {
      results.push({
        key: item.key,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
      skipped++;
    }
  }

  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");

  return { ok: true, created, skipped, results };
}
