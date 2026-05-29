/**
 * T4.11 — Intake request notifications.
 *
 * Composes the shared `dispatchNotification` helper into the two intake
 * moments that need to reach a human:
 *
 *   1. SUBMITTED → notify the approvers (account owners + admins) that a
 *      purchase request is waiting. The requester is NOT notified about
 *      their own submission.
 *   2. DECIDED   → notify the original requester of the approve / deny /
 *      duplicate outcome, including the reviewer's note.
 *
 * Both are fire-and-forget from the action layer: a slow or failing email
 * must never block the actual approve/deny mutation, which has already
 * committed (and is audit-logged) by the time we get here.
 *
 * Withdraw is intentionally NOT notified — it's the requester's own action,
 * and the approver's pending badge simply decrements.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  usersTable,
  type IntakeRequest,
} from "@server/infrastructure/db/schema";
import { dispatchNotification } from "@server/application/notifications/dispatch";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "intake-requests.notifications" });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

function formatUsdCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Notify approvers (owners + admins, minus the requester) that a new
 * purchase request needs review. Returns the number of recipients reached
 * so callers/tests can assert fan-out.
 */
export async function notifyIntakeSubmitted(input: {
  request: IntakeRequest;
  requesterName: string | null;
}): Promise<{ recipientCount: number }> {
  const { request } = input;

  const approvers = await db
    .select({
      id: usersTable.id,
      workEmail: usersTable.workEmail,
      fullName: usersTable.fullName,
      notificationPrefs: usersTable.notificationPrefs,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.accountId, request.accountId),
        inArray(usersTable.role, ["owner", "admin"]),
        // Don't notify the requester about their own submission, even if
        // they happen to be an admin/owner.
        ne(usersTable.id, request.requesterUserId)
      )
    );

  if (approvers.length === 0) {
    log.info("intake_submitted_no_approvers", { requestId: request.id });
    return { recipientCount: 0 };
  }

  const url = `${APP_URL}/requests/${request.id}`;
  const requesterLabel = input.requesterName ?? "A teammate";
  const subject = `Purchase request: ${request.vendor} ${request.product} (${formatUsdCents(request.estimatedAnnualUsdCents)}/yr)`;

  await Promise.all(
    approvers.map((approver) =>
      dispatchNotification({
        accountId: request.accountId,
        recipient: approver,
        trigger: "intake_request_submitted",
        entityType: "intake_request",
        entityId: request.id,
        inAppPayload: {
          vendor: request.vendor,
          product: request.product,
          estimatedAnnualUsdCents: request.estimatedAnnualUsdCents,
          requesterName: input.requesterName,
        },
        email: {
          subject,
          html: renderSubmittedHtml({
            requesterLabel,
            vendor: request.vendor,
            product: request.product,
            annual: formatUsdCents(request.estimatedAnnualUsdCents),
            businessCase: request.businessCase,
            url,
          }),
          text: renderSubmittedText({
            requesterLabel,
            vendor: request.vendor,
            product: request.product,
            annual: formatUsdCents(request.estimatedAnnualUsdCents),
            url,
          }),
        },
      }).catch((err) => {
        // One bad recipient must not abort the rest.
        log.warn("intake_submitted_dispatch_failed", {
          requestId: request.id,
          recipientId: approver.id,
          err: err instanceof Error ? err.message : String(err),
        });
      })
    )
  );

  return { recipientCount: approvers.length };
}

export type IntakeDecision = "approved" | "denied" | "duplicate";

/**
 * Notify the original requester of the decision on their request.
 * No-op (returns reached:false) if the requester user no longer exists.
 */
export async function notifyIntakeDecision(input: {
  request: IntakeRequest;
  decision: IntakeDecision;
}): Promise<{ reached: boolean }> {
  const { request, decision } = input;

  const [requester] = await db
    .select({
      id: usersTable.id,
      workEmail: usersTable.workEmail,
      fullName: usersTable.fullName,
      notificationPrefs: usersTable.notificationPrefs,
    })
    .from(usersTable)
    .where(eq(usersTable.id, request.requesterUserId))
    .limit(1);

  if (!requester) {
    log.info("intake_decision_requester_missing", { requestId: request.id });
    return { reached: false };
  }

  const url = `${APP_URL}/requests/${request.id}`;
  const verb =
    decision === "approved"
      ? "approved"
      : decision === "denied"
        ? "declined"
        : "marked as a duplicate";
  const subject = `Your purchase request for ${request.vendor} ${request.product} was ${verb}`;

  await dispatchNotification({
    accountId: request.accountId,
    recipient: requester,
    trigger: "intake_request_decided",
    entityType: "intake_request",
    entityId: request.id,
    inAppPayload: {
      vendor: request.vendor,
      product: request.product,
      decision,
      reviewerNote: request.reviewerNote,
    },
    email: {
      subject,
      html: renderDecisionHtml({
        verb,
        decision,
        vendor: request.vendor,
        product: request.product,
        reviewerNote: request.reviewerNote,
        url,
      }),
      text: renderDecisionText({
        verb,
        vendor: request.vendor,
        product: request.product,
        reviewerNote: request.reviewerNote,
        url,
      }),
    },
  }).catch((err) => {
    log.warn("intake_decision_dispatch_failed", {
      requestId: request.id,
      err: err instanceof Error ? err.message : String(err),
    });
  });

  return { reached: true };
}

// ─── Email templates ────────────────────────────────────────────────────

function shell(bodyHtml: string): string {
  return `<!doctype html>
<html><body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #0f172a; max-width: 560px; margin: 0 auto; padding: 24px;">
${bodyHtml}
<p style="margin: 28px 0 0; font-size: 12px; color: #64748b;">
  Renewal Radar is your renewal advisor — we never contact your vendors on your behalf.
</p>
</body></html>`;
}

function ctaButton(url: string, label: string): string {
  return `<p style="margin: 0 0 20px;"><a href="${url}" style="display:inline-block; background:#4f46e5; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">${label}</a></p>`;
}

function renderSubmittedHtml(p: {
  requesterLabel: string;
  vendor: string;
  product: string;
  annual: string;
  businessCase: string;
  url: string;
}): string {
  return shell(`
  <h1 style="font-size:18px; margin:0 0 12px;">A purchase request needs your review</h1>
  <p style="margin:0 0 12px;">${escapeHtml(p.requesterLabel)} requested <strong>${escapeHtml(p.vendor)} ${escapeHtml(p.product)}</strong> at about <strong>${escapeHtml(p.annual)}/yr</strong>.</p>
  <p style="margin:0 0 8px; font-size:13px; color:#475569;"><strong>Business case</strong></p>
  <blockquote style="margin:0 0 20px; padding:8px 12px; border-left:3px solid #e2e8f0; color:#334155; font-size:14px; white-space:pre-wrap;">${escapeHtml(p.businessCase.slice(0, 600))}</blockquote>
  ${ctaButton(p.url, "Review the request")}
  <p style="margin:0; font-size:13px; color:#475569;">Approving creates a draft subscription you can finish under Subscriptions.</p>`);
}

function renderSubmittedText(p: {
  requesterLabel: string;
  vendor: string;
  product: string;
  annual: string;
  url: string;
}): string {
  return [
    "A purchase request needs your review.",
    "",
    `${p.requesterLabel} requested ${p.vendor} ${p.product} at about ${p.annual}/yr.`,
    "",
    `Review it: ${p.url}`,
    "",
    "Renewal Radar is your renewal advisor — we never contact your vendors on your behalf.",
  ].join("\n");
}

function renderDecisionHtml(p: {
  verb: string;
  decision: IntakeDecision;
  vendor: string;
  product: string;
  reviewerNote: string | null;
  url: string;
}): string {
  const noteBlock = p.reviewerNote
    ? `<p style="margin:0 0 8px; font-size:13px; color:#475569;"><strong>Reviewer note</strong></p>
       <blockquote style="margin:0 0 20px; padding:8px 12px; border-left:3px solid #e2e8f0; color:#334155; font-size:14px; white-space:pre-wrap;">${escapeHtml(p.reviewerNote)}</blockquote>`
    : "";
  const followUp =
    p.decision === "approved"
      ? `<p style="margin:0; font-size:13px; color:#475569;">A draft subscription was created from your request.</p>`
      : "";
  return shell(`
  <h1 style="font-size:18px; margin:0 0 12px;">Your purchase request was ${escapeHtml(p.verb)}</h1>
  <p style="margin:0 0 16px;"><strong>${escapeHtml(p.vendor)} ${escapeHtml(p.product)}</strong></p>
  ${noteBlock}
  ${ctaButton(p.url, "View the request")}
  ${followUp}`);
}

function renderDecisionText(p: {
  verb: string;
  vendor: string;
  product: string;
  reviewerNote: string | null;
  url: string;
}): string {
  return [
    `Your purchase request for ${p.vendor} ${p.product} was ${p.verb}.`,
    p.reviewerNote ? `\nReviewer note: ${p.reviewerNote}` : "",
    "",
    `View it: ${p.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}
