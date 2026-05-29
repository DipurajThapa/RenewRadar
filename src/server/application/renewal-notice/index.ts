/**
 * A3 — generate + persist a safe-agent INTERNAL renewal-notice draft, and let
 * the human edit it. Composed deterministically from the latest stored Renewal
 * Intelligence Brief (NO new LLM call → free, offline, reproducible). Renewal
 * Radar drafts the internal memo; a human reviews + sends. Never addressed to
 * the vendor.
 *
 * [C4] Reads (brief + subscription detail) run before the write transaction;
 * the insert + audit commit in one tx.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalNoticeDraftsTable,
  type RenewalNoticeDraft,
} from "@server/infrastructure/db/schema";
import { getLatestBrief } from "@server/application/renewal-brief";
import { getSubscriptionDetail } from "@server/infrastructure/db/repositories/subscriptions";
import { composeInternalNotice } from "@server/domain/renewal-notice/compose";
import { annualizeCents } from "@server/domain/billing/annualize";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import type { RenewalIntelligenceBrief } from "@server/infrastructure/ai/reasoning/types";

export class RenewalNoticeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenewalNoticeError";
  }
}

export async function generateAndStoreNoticeDraft(input: {
  accountId: string;
  subscriptionId: string;
  actorUserId: string;
}): Promise<RenewalNoticeDraft> {
  const briefRow = await getLatestBrief(input.accountId, input.subscriptionId);
  if (!briefRow) {
    throw new RenewalNoticeError(
      "Generate a Renewal Intelligence Brief first — the notice is composed from it."
    );
  }
  const detail = await getSubscriptionDetail(input.accountId, input.subscriptionId);
  if (!detail) {
    throw new RenewalNoticeError("Subscription not found in this account.");
  }
  const brief = briefRow.briefJson as RenewalIntelligenceBrief;
  const { subscription: sub, vendor } = detail;

  const { subject, bodyText } = composeInternalNotice({
    vendorName: vendor.name,
    productName: sub.productName,
    termEndDate: sub.termEndDate,
    noticePeriodDays: sub.noticePeriodDays,
    annualValueCents: annualizeCents(sub.totalCostPerPeriodCents, sub.billingCycle),
    autoRenew: sub.autoRenew,
    recommendedAction: brief.recommendedAction,
    headline: brief.headline,
    confidencePct: brief.meta.confidencePct,
    points: (brief.claims ?? []).slice(0, 4).map((c) => c.statement),
  });

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(renewalNoticeDraftsTable)
      .values({
        accountId: input.accountId,
        subscriptionId: input.subscriptionId,
        renewalBriefId: briefRow.id,
        status: "draft",
        subject,
        bodyText,
        createdByUserId: input.actorUserId,
      })
      .returning();
    if (!row) throw new RenewalNoticeError("Failed to store notice draft.");

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.renewalNoticeDrafted,
      target: { entityType: "renewal_notice_draft", entityId: row.id },
      after: { subject, recommendedAction: brief.recommendedAction },
    });
    return row;
  });
}

export async function updateNoticeDraftBody(input: {
  accountId: string;
  draftId: string;
  actorUserId: string;
  subject: string;
  bodyText: string;
}): Promise<RenewalNoticeDraft> {
  if (!input.subject.trim() || !input.bodyText.trim()) {
    throw new RenewalNoticeError("Subject and body cannot be empty.");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(renewalNoticeDraftsTable)
      .set({
        subject: input.subject,
        bodyText: input.bodyText,
        status: "edited",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(renewalNoticeDraftsTable.id, input.draftId),
          eq(renewalNoticeDraftsTable.accountId, input.accountId)
        )
      )
      .returning();
    if (!row) {
      throw new RenewalNoticeError("Notice draft not found in this account.");
    }
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.renewalNoticeEdited,
      target: { entityType: "renewal_notice_draft", entityId: row.id },
      after: { subject: input.subject },
    });
    return row;
  });
}
