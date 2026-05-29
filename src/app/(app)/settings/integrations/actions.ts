"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  requireTierFeature,
  TierFeatureDeniedError,
} from "@server/domain/billing/tier-features";
import {
  disableIntegration,
  upsertIntegration,
} from "@server/application/integrations";
import { getIcsIntegration } from "@server/infrastructure/db/repositories/integrations";

const slackUrlSchema = z
  .string()
  .url()
  .startsWith(
    "https://hooks.slack.com/services/",
    "Use a Slack incoming webhook URL"
  );

export type IntegrationResult =
  | { ok: true }
  | { ok: false; formError: string };

export async function saveSlackIntegrationAction(
  webhookUrl: string
): Promise<IntegrationResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
    // Slack alerts are a Growth+ feature. UI hides the form on lower tiers;
    // this is defense-in-depth.
    requireTierFeature(account.planTier, "slackAlerts");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TierFeatureDeniedError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  const parsed = slackUrlSchema.safeParse(webhookUrl);
  if (!parsed.success) {
    return {
      ok: false,
      formError: parsed.error.issues[0]?.message ?? "Invalid Slack webhook URL",
    };
  }

  try {
    await upsertIntegration({
      accountId: account.id,
      actorUserId: user.id,
      kind: "slack_webhook",
      config: { webhookUrl: parsed.data },
      enabled: true,
    });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (err) {
    console.error("[saveSlackIntegrationAction] failed:", err);
    return { ok: false, formError: "Couldn't save. Please try again." };
  }
}

export async function disableSlackIntegrationAction(): Promise<IntegrationResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, formError: err.message };
    throw err;
  }

  try {
    await disableIntegration({
      accountId: account.id,
      actorUserId: user.id,
      kind: "slack_webhook",
    });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (err) {
    console.error("[disableSlackIntegrationAction] failed:", err);
    return { ok: false, formError: "Couldn't disable. Please try again." };
  }
}

/**
 * Generate or rotate the ICS export token. Returns the new token URL.
 */
export async function rotateIcsTokenAction(): Promise<
  IntegrationResult & { token?: string }
> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, formError: err.message };
    throw err;
  }

  // 32 bytes hex = 64 chars, way past brute-force range.
  const token = randomBytes(32).toString("hex");
  try {
    await upsertIntegration({
      accountId: account.id,
      actorUserId: user.id,
      kind: "ics_export",
      config: { token },
      enabled: true,
    });
    revalidatePath("/settings/integrations");
    return { ok: true, token };
  } catch (err) {
    console.error("[rotateIcsTokenAction] failed:", err);
    return { ok: false, formError: "Couldn't rotate. Please try again." };
  }
}

export async function disableIcsExportAction(): Promise<IntegrationResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, formError: err.message };
    throw err;
  }

  try {
    await disableIntegration({
      accountId: account.id,
      actorUserId: user.id,
      kind: "ics_export",
    });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (err) {
    console.error("[disableIcsExportAction] failed:", err);
    return { ok: false, formError: "Couldn't disable. Please try again." };
  }
}

// Re-export for the page to read the current token without round-tripping.
export { getIcsIntegration };
