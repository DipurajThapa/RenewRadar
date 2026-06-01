import { and, eq, inArray } from "drizzle-orm";
import { inngest } from "@server/jobs/client";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  notificationsTable,
  renewalEventsTable,
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import {
  NOTICE_THRESHOLDS,
  daysUntilNoticeDeadline,
  calculateNoticeDeadline,
} from "@server/domain/notice-deadline/calculate";
import { annualizeCents } from "@server/domain/billing/annualize";
import {
  emailSubjectForThreshold,
  matchingThreshold,
  triggerForThreshold,
} from "@server/domain/notice-deadline/threshold";
import { renderNoticeDeadlineEmail } from "@server/infrastructure/email/templates/notice-deadline-alert";
import { sendEmail } from "@server/infrastructure/email/client";
import { resolveChannelPreference } from "@server/domain/notifications/labels";
import { runComplianceExpiryAlerts } from "@server/jobs/functions/compliance-expiry-alerts";

/**
 * Daily cron at 08:00 UTC.
 *
 * For each active, auto-renewing subscription whose notice deadline falls
 * exactly on one of the threshold days [30, 14, 7, 3, 1] from today,
 * send the corresponding email — unless a notification for that
 * (user, trigger, subscription) tuple already exists.
 *
 * Dedup mechanism: the `notification_dedupe` unique constraint on
 * (user_id, trigger, entity_type, entity_id). We `insert ... on conflict
 * do nothing` semantics via a try/catch — Postgres unique-violation
 * means "already sent" and we skip silently.
 */
export const noticeDeadlineAlerts = inngest.createFunction(
  {
    id: "notice-deadline-alerts",
    name: "Daily notice deadline alerts",
    retries: 3,
  },
  { cron: "0 8 * * *" },
  async ({ step }) => {
    const today = new Date();

    // Pre-compute target dates for each threshold
    const targets = NOTICE_THRESHOLDS.map((threshold) => {
      const d = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
      );
      d.setUTCDate(d.getUTCDate() + threshold);
      return {
        threshold,
        date: d.toISOString().split("T")[0]!,
      };
    });
    const targetDates = targets.map((t) => t.date);

    // Pull every renewal event whose notice_deadline matches any threshold today
    const due = await step.run("fetch-due-events", async () =>
      db
        .select({
          renewalEvent: renewalEventsTable,
          subscription: subscriptionsTable,
          vendor: vendorsTable,
          account: accountsTable,
        })
        .from(renewalEventsTable)
        .innerJoin(
          subscriptionsTable,
          eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
        )
        .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
        .innerJoin(
          accountsTable,
          eq(renewalEventsTable.accountId, accountsTable.id)
        )
        .where(
          and(
            inArray(renewalEventsTable.noticeDeadline, targetDates),
            eq(subscriptionsTable.status, "active"),
            eq(subscriptionsTable.autoRenew, true),
            inArray(renewalEventsTable.status, [
              "upcoming",
              "notice_window",
              "action_needed",
            ])
          )
        )
    );

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of due) {
      const daysUntil = daysUntilNoticeDeadline(
        row.subscription.termEndDate,
        row.subscription.noticePeriodDays,
        today
      );
      const threshold = matchingThreshold(daysUntil);
      if (!threshold) continue; // edge case: state moved between query and processing

      const trigger = triggerForThreshold(threshold);

      // Recipients: subscription owner if set, else account owners
      const recipients = await step.run(
        `recipients-${row.subscription.id}-${threshold}`,
        async () => {
          if (row.subscription.ownerUserId) {
            const owner = await db
              .select()
              .from(usersTable)
              .where(eq(usersTable.id, row.subscription.ownerUserId))
              .limit(1);
            if (owner[0]) return owner;
          }
          return db
            .select()
            .from(usersTable)
            .where(
              and(
                eq(usersTable.accountId, row.subscription.accountId),
                eq(usersTable.role, "owner")
              )
            );
        }
      );

      for (const user of recipients) {
        const channelPref = resolveChannelPreference(
          user.notificationPrefs,
          trigger
        );

        // ── In-app row ────────────────────────────────────────────────────
        // Always attempt the insert; the unique constraint (which now includes
        // channel) silently dedupes a repeat. If the user has muted in_app for
        // this trigger we still skip — defense-in-depth, even though the email
        // branch below has the same check.
        if (channelPref.in_app) {
          await step.run(
            `inapp-${row.subscription.id}-${user.id}-${threshold}`,
            async () => {
              try {
                await db.insert(notificationsTable).values({
                  accountId: row.subscription.accountId,
                  userId: user.id,
                  channel: "in_app",
                  trigger,
                  entityType: "subscription",
                  entityId: row.subscription.id,
                  status: "queued",
                  payload: {
                    threshold,
                    vendorName: row.vendor.name,
                    productName: row.subscription.productName,
                  },
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (
                  !msg.includes("notification_dedupe") &&
                  !msg.includes("unique")
                ) {
                  throw err;
                }
              }
            }
          );
        }

        // ── Email row + send ──────────────────────────────────────────────
        if (!channelPref.email) {
          skipped++;
          continue;
        }

        const result = await step.run(
          `send-${row.subscription.id}-${user.id}-${threshold}`,
          async () => {
            try {
              await db.insert(notificationsTable).values({
                accountId: row.subscription.accountId,
                userId: user.id,
                channel: "email",
                trigger,
                entityType: "subscription",
                entityId: row.subscription.id,
                status: "queued",
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (msg.includes("notification_dedupe") || msg.includes("unique")) {
                return { result: "skipped" as const };
              }
              throw err;
            }

            const html = await renderNoticeDeadlineEmail({
              userName: user.fullName ?? user.workEmail,
              vendorName: row.vendor.name,
              productName: row.subscription.productName,
              annualValueCents: annualizeCents(
                row.subscription.totalCostPerPeriodCents,
                row.subscription.billingCycle
              ),
              renewalDate: row.subscription.termEndDate,
              noticeDeadline: calculateNoticeDeadline(
                row.subscription.termEndDate,
                row.subscription.noticePeriodDays
              )
                .toISOString()
                .split("T")[0]!,
              daysUntilDeadline: threshold,
              decisionUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com"}/subscriptions/${row.subscription.id}/decide?event=${row.renewalEvent.id}`,
            });

            const emailResult = await sendEmail({
              to: user.workEmail,
              subject: emailSubjectForThreshold(threshold, row.vendor.name),
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
                  threshold,
                },
              })
              .where(
                and(
                  eq(notificationsTable.userId, user.id),
                  eq(notificationsTable.entityId, row.subscription.id),
                  eq(notificationsTable.trigger, trigger),
                  eq(notificationsTable.channel, "email")
                )
              );

            return {
              result: emailResult.ok ? ("sent" as const) : ("failed" as const),
              messageId: emailResult.messageId,
            };
          }
        );

        if (result.result === "sent") sent++;
        else if (result.result === "skipped") skipped++;
        else failed++;
      }
    }

    // Second phase, same daily firing (no parallel cron): warn on compliance
    // artifacts whose `expiresAt` is approaching, reusing the notification +
    // email dispatch machinery above.
    const compliance = await runComplianceExpiryAlerts(
      <T,>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>
    );

    return {
      processed: due.length,
      sent,
      skipped,
      failed,
      compliance,
    };
  }
);

// annualizeCents moved to @/lib/billing/annualize
