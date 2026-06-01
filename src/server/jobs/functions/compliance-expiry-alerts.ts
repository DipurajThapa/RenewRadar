/**
 * Compliance artifact expiry alerts — the second phase of the daily
 * deadline-alert cron (see notice-deadline-alerts.ts). NOT a parallel cron:
 * it's invoked from `noticeDeadlineAlerts` on the same 08:00 UTC firing.
 *
 * Closes a silent reliability gap: `complianceArtifactsTable.expiresAt` (and
 * its dedicated index) existed, and `listExpiringComplianceArtifacts` was
 * written "for the alert cron" — but nothing ever scanned it. A SOC 2 report,
 * insurance certificate, or DPA could lapse with zero alert, zero digest line,
 * zero notification, in a product whose whole promise is "never miss a
 * deadline."
 *
 * Reuse, not reinvention. This phase leans on the existing dispatch stack:
 *   - `listExpiringComplianceArtifacts` — the pre-existing (previously unwired)
 *     repository query, already joined to the vendor for its name.
 *   - `resolveChannelPreference` — the same per-trigger channel resolution the
 *     notice-deadline phase uses.
 *   - the `notification_dedupe` unique constraint — the same "already sent"
 *     guard, so repeated daily runs don't re-notify.
 *   - `sendEmail` — the same transport.
 *   - `recordVendorEvent` — emits the `compliance_doc_expired` timeline event,
 *     a vendor-event kind that previously had a label but no producer.
 *
 * The email renderer is injected (defaulting to a lazily-imported template) so
 * the testable core's static module graph stays free of the `.tsx` template —
 * vitest's esbuild inherits `jsx: "preserve"` from the Next.js tsconfig and
 * can't parse JSX, so importing a template here would make this un-testable.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  notificationsTable,
  subscriptionsTable,
  usersTable,
  vendorEventsTable,
} from "@server/infrastructure/db/schema";
import {
  listExpiringComplianceArtifacts,
  type ComplianceArtifactRow,
} from "@server/infrastructure/db/repositories/compliance";
import { resolveChannelPreference } from "@server/domain/notifications/labels";
import { COMPLIANCE_ARTIFACT_LABEL } from "@server/domain/vendor-memory/event-labels";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";
import { sendEmail } from "@server/infrastructure/email/client";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

/**
 * How far ahead we warn before a compliance document lapses. A single window
 * (not the 30/14/7/3/1 cadence of renewal notices): the dedupe constraint on
 * the notification row means each artifact alerts exactly once — the first day
 * it enters the window — so there's no day-by-day spam to escalate against.
 */
export const COMPLIANCE_EXPIRY_WINDOW_DAYS = 30;

type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>;

export type ComplianceExpiryEmailProps = {
  userName: string;
  vendorName: string;
  artifactKindLabel: string;
  expiresAt: string;
  daysUntilExpiry: number;
  vendorUrl: string;
};

export type RenderComplianceExpiryEmail = (
  props: ComplianceExpiryEmailProps
) => Promise<string>;

export type ComplianceExpiryAlertsResult = {
  accountsScanned: number;
  artifactsInWindow: number;
  /** Artifacts that produced at least one fresh notification this run. */
  artifactsAlerted: number;
  notificationsCreated: number;
  eventsRecorded: number;
};

/** Default renderer — lazily imported so the `.tsx` stays out of the static graph. */
const lazyRenderEmail: RenderComplianceExpiryEmail = async (props) => {
  const { renderComplianceExpiryEmail } = await import(
    "@server/infrastructure/email/templates/compliance-expiry-alert"
  );
  return renderComplianceExpiryEmail(props);
};

/**
 * Scan every account for compliance artifacts expiring within
 * `COMPLIANCE_EXPIRY_WINDOW_DAYS` and alert the account owners. Extracted (like
 * `runRenewalAgent` / `runPastDueGraceEnforcement`) so it can be unit-tested
 * with a pass-through step runner.
 *
 * Idempotent: the notification dedupe handles repeat notifications, and the
 * vendor event is gated on the absence of a prior event for the artifact, so
 * it's recorded once regardless of how many days the artifact stays in-window
 * or whether owners have muted their personal alerts.
 */
export async function runComplianceExpiryAlerts(
  runStep: StepRunner,
  renderEmail: RenderComplianceExpiryEmail = lazyRenderEmail
): Promise<ComplianceExpiryAlertsResult> {
  const accounts = await runStep("compliance-list-accounts", async () =>
    db.select({ id: accountsTable.id }).from(accountsTable)
  );

  let artifactsInWindow = 0;
  let artifactsAlerted = 0;
  let notificationsCreated = 0;
  let eventsRecorded = 0;

  for (const account of accounts) {
    const expiring = await runStep(
      `compliance-expiring-${account.id}`,
      async () =>
        listExpiringComplianceArtifacts(
          account.id,
          COMPLIANCE_EXPIRY_WINDOW_DAYS
        )
    );
    if (expiring.length === 0) continue;
    artifactsInWindow += expiring.length;

    // Compliance artifacts are account/vendor-scoped, not subscription-scoped
    // (there may be no subscription, hence no subscription owner), so route to
    // the account owners — the same fallback the notice-deadline phase uses.
    const owners = await runStep(`compliance-owners-${account.id}`, async () =>
      db
        .select()
        .from(usersTable)
        .where(
          and(
            eq(usersTable.accountId, account.id),
            eq(usersTable.role, "owner")
          )
        )
    );

    for (const artifact of expiring) {
      if (!artifact.expiresAt) continue; // repo filters non-null; belt-and-suspenders
      const expiresAtStr = artifact.expiresAt.toISOString().split("T")[0]!;
      const daysUntilExpiry = Math.max(
        0,
        Math.ceil((artifact.expiresAt.getTime() - Date.now()) / 86_400_000)
      );
      const kindLabel =
        COMPLIANCE_ARTIFACT_LABEL[artifact.kind] ?? artifact.kind;

      let anyFresh = false;

      for (const user of owners) {
        const channelPref = resolveChannelPreference(
          user.notificationPrefs,
          "compliance_doc_expiring"
        );

        // ── In-app row ──────────────────────────────────────────────────
        if (channelPref.in_app) {
          const created = await runStep(
            `compliance-inapp-${artifact.id}-${user.id}`,
            async () =>
              insertComplianceNotification({
                accountId: account.id,
                userId: user.id,
                channel: "in_app",
                artifactId: artifact.id,
                payload: {
                  vendorName: artifact.vendorName,
                  artifactKind: artifact.kind,
                  expiresAt: expiresAtStr,
                  daysUntilExpiry,
                },
              })
          );
          if (created) {
            notificationsCreated++;
            anyFresh = true;
          }
        }

        // ── Email row + send ────────────────────────────────────────────
        if (!channelPref.email) continue;

        const created = await runStep(
          `compliance-email-${artifact.id}-${user.id}`,
          async () => {
            const inserted = await insertComplianceNotification({
              accountId: account.id,
              userId: user.id,
              channel: "email",
              artifactId: artifact.id,
            });
            if (!inserted) return false;

            const html = await renderEmail({
              userName: user.fullName ?? user.workEmail,
              vendorName: artifact.vendorName,
              artifactKindLabel: kindLabel,
              expiresAt: expiresAtStr,
              daysUntilExpiry,
              vendorUrl: `${APP_URL}/vendors/${artifact.vendorId}`,
            });

            const emailResult = await sendEmail({
              to: user.workEmail,
              subject: `${kindLabel} for ${artifact.vendorName} expires ${expiresAtStr}`,
              html,
            });

            await db
              .update(notificationsTable)
              .set({
                status: emailResult.ok ? "sent" : "failed",
                sentAt: new Date(),
                payload: {
                  messageId: emailResult.messageId,
                  error: emailResult.error,
                  artifactKind: artifact.kind,
                  expiresAt: expiresAtStr,
                },
              })
              .where(
                and(
                  eq(notificationsTable.userId, user.id),
                  eq(notificationsTable.entityType, "compliance_artifact"),
                  eq(notificationsTable.entityId, artifact.id),
                  eq(notificationsTable.trigger, "compliance_doc_expiring"),
                  eq(notificationsTable.channel, "email")
                )
              );

            return true;
          }
        );
        if (created) {
          notificationsCreated++;
          anyFresh = true;
        }
      }

      if (anyFresh) artifactsAlerted++;

      // Timeline event — once per artifact, independent of owner mute prefs.
      const recorded = await runStep(
        `compliance-event-${artifact.id}`,
        async () =>
          recordComplianceExpiredEvent(account.id, artifact, expiresAtStr)
      );
      if (recorded) eventsRecorded++;
    }
  }

  return {
    accountsScanned: accounts.length,
    artifactsInWindow,
    artifactsAlerted,
    notificationsCreated,
    eventsRecorded,
  };
}

/**
 * Insert a `compliance_doc_expiring` notification, relying on the
 * `notification_dedupe` unique constraint to make repeats a no-op. Returns
 * true if a fresh row was created, false if it was already there — the same
 * "unique violation means already sent" idiom as the notice-deadline phase.
 */
async function insertComplianceNotification(input: {
  accountId: string;
  userId: string;
  channel: "email" | "in_app";
  artifactId: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await db.insert(notificationsTable).values({
      accountId: input.accountId,
      userId: input.userId,
      channel: input.channel,
      trigger: "compliance_doc_expiring",
      entityType: "compliance_artifact",
      entityId: input.artifactId,
      status: "queued",
      payload: input.payload,
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("notification_dedupe") || msg.includes("unique")) {
      return false;
    }
    throw err;
  }
}

/**
 * Record the `compliance_doc_expired` vendor-timeline event for an artifact,
 * once. Gated on the absence of a prior event for the same artifact so the
 * timeline reflects the expiry exactly once across repeated cron runs and
 * regardless of per-user mute prefs. SYSTEM actor (null) — the cron raised it.
 */
async function recordComplianceExpiredEvent(
  accountId: string,
  artifact: ComplianceArtifactRow,
  expiresAtStr: string
): Promise<boolean> {
  const [prior] = await db
    .select({ id: vendorEventsTable.id })
    .from(vendorEventsTable)
    .where(
      and(
        eq(vendorEventsTable.accountId, accountId),
        eq(vendorEventsTable.kind, "compliance_doc_expired"),
        eq(vendorEventsTable.relatedEntityType, "compliance_artifact"),
        eq(vendorEventsTable.relatedEntityId, artifact.id)
      )
    )
    .limit(1);
  if (prior) return false;

  // Link to any subscription with this vendor so the event sits on the
  // vendor's timeline; null is fine when there's no subscription.
  const [activeSub] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.accountId, accountId),
        eq(subscriptionsTable.vendorId, artifact.vendorId)
      )
    )
    .limit(1);

  await recordVendorEvent(db, {
    accountId,
    vendorId: artifact.vendorId,
    subscriptionId: activeSub?.id ?? null,
    kind: "compliance_doc_expired",
    payload: {
      artifactKind: artifact.kind,
      expiresAt: expiresAtStr,
    },
    actorUserId: null,
    relatedEntityType: "compliance_artifact",
    relatedEntityId: artifact.id,
  });
  return true;
}
