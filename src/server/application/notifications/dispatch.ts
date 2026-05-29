/**
 * Shared notification dispatch helper.
 *
 * One place that knows how to fan a single (recipient, trigger, entity) out
 * to the in-app feed and/or email, honoring the user's channel preferences
 * and the `notification_dedupe` unique constraint
 * (user_id, trigger, entity_type, entity_id, channel).
 *
 * This is the reusable primitive. Synchronous request-path callers (server
 * actions) use it directly; see `application/intake-requests/notifications.ts`.
 *
 * NOTE: the daily cron at `jobs/functions/notice-deadline-alerts.ts` predates
 * this helper and still inlines the same pattern wrapped in Inngest
 * `step.run(...)` blocks (so each send is independently retried/replayed).
 * Migrating the cron onto this helper is a separate task — it would need a
 * step-aware variant. New notification code paths should use THIS helper so we
 * don't grow a third copy of the fan-out logic.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { notificationsTable } from "@server/infrastructure/db/schema";
import { resolveChannelPreference } from "@server/domain/notifications/labels";
import { sendEmail } from "@server/infrastructure/email/client";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "notifications.dispatch" });

export type DispatchRecipient = {
  id: string;
  workEmail: string;
  fullName: string | null;
  /** The user's saved `notification_prefs` jsonb blob (may be null). */
  notificationPrefs: unknown;
};

export type DispatchInput = {
  accountId: string;
  recipient: DispatchRecipient;
  trigger: string;
  entityType: string;
  entityId: string;
  /** Stored on the in-app row so the feed can render without a re-fetch. */
  inAppPayload?: Record<string, unknown>;
  email: {
    subject: string;
    html: string;
    text?: string;
  };
};

export type ChannelOutcome =
  | "created" // in-app row inserted
  | "sent" // email sent
  | "failed" // email send returned not-ok
  | "deduped" // unique constraint already had a row
  | "muted"; // user turned this channel off for this trigger

export type DispatchResult = {
  inApp: ChannelOutcome;
  email: ChannelOutcome;
};

function isDedupeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("notification_dedupe") || msg.includes("unique");
}

/**
 * Dispatch to one recipient. Never throws on a send failure — returns the
 * outcome per channel so the caller can log/aggregate. A genuinely
 * unexpected DB error (not a dedupe conflict) still propagates.
 */
export async function dispatchNotification(
  input: DispatchInput
): Promise<DispatchResult> {
  const pref = resolveChannelPreference(input.recipient.notificationPrefs, input.trigger);

  let inApp: ChannelOutcome = "muted";
  let email: ChannelOutcome = "muted";

  // ── In-app ──────────────────────────────────────────────────────────────
  if (pref.in_app) {
    try {
      await db.insert(notificationsTable).values({
        accountId: input.accountId,
        userId: input.recipient.id,
        channel: "in_app",
        trigger: input.trigger as never, // trigger is a runtime-validated enum value
        entityType: input.entityType,
        entityId: input.entityId,
        status: "queued",
        payload: input.inAppPayload ?? null,
      });
      inApp = "created";
    } catch (err) {
      if (!isDedupeError(err)) throw err;
      inApp = "deduped";
    }
  }

  // ── Email ───────────────────────────────────────────────────────────────
  if (pref.email) {
    let alreadySent = false;
    try {
      await db.insert(notificationsTable).values({
        accountId: input.accountId,
        userId: input.recipient.id,
        channel: "email",
        trigger: input.trigger as never,
        entityType: input.entityType,
        entityId: input.entityId,
        status: "queued",
      });
    } catch (err) {
      if (!isDedupeError(err)) throw err;
      alreadySent = true;
    }

    if (alreadySent) {
      email = "deduped";
    } else {
      const result = await sendEmail({
        to: input.recipient.workEmail,
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
      });
      await db
        .update(notificationsTable)
        .set({
          status: result.ok ? "sent" : "failed",
          sentAt: new Date(),
          payload: { messageId: result.messageId, error: result.error },
        })
        .where(
          and(
            eq(notificationsTable.userId, input.recipient.id),
            eq(notificationsTable.trigger, input.trigger as never),
            eq(notificationsTable.entityType, input.entityType),
            eq(notificationsTable.entityId, input.entityId),
            eq(notificationsTable.channel, "email")
          )
        );
      email = result.ok ? "sent" : "failed";
      if (!result.ok) {
        log.warn("notification email send failed", {
          trigger: input.trigger,
          entityId: input.entityId,
          error: result.error,
        });
      }
    }
  }

  return { inApp, email };
}
