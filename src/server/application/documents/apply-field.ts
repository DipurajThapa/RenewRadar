/**
 * Apply an accepted/edited extracted field to its target row.
 *
 * THIS IS THE ONLY PATH that writes an AI-extracted value into
 * `subscription` or `renewal_event`. Binding principle 4 + ADR 0003 both
 * require that:
 *   - the field's review_status is "accepted" or "edited" (not "pending"
 *     or "rejected")
 *   - a real human's user ID is recorded as reviewer
 *   - the write happens in the same transaction as the audit log entry
 *
 * Per-fieldKey targets:
 *   renewal_date           → subscription.termEndDate + renewal_event.{renewal,notice}_deadline
 *   notice_period_days     → subscription.noticePeriodDays + recompute renewal_event.noticeDeadline
 *   auto_renewal           → subscription.autoRenew
 *   contract_value_cents   → subscription.{unitPriceCents,totalCostPerPeriodCents}
 *   price_increase_clause  → subscription.notes (appended; no first-class column yet)
 *   cancellation_method    → vendor.cancellationNotes (appended)
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type { AiExtractedField } from "@server/infrastructure/db/schema";
import { calculateNoticeDeadline } from "@server/domain/notice-deadline/calculate";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";

export class ApplyFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyFieldError";
  }
}

/**
 * Apply a single accepted/edited field. Idempotent — calling twice is safe
 * because the field's review_status flips to "applied" on success.
 */
export async function applyExtractedField(input: {
  accountId: string;
  actorUserId: string;
  fieldId: string;
}): Promise<{ ok: true; appliedTo: string } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [field] = await tx
      .select()
      .from(aiExtractedFieldsTable)
      .where(
        and(
          eq(aiExtractedFieldsTable.id, input.fieldId),
          eq(aiExtractedFieldsTable.accountId, input.accountId)
        )
      )
      .limit(1);
    if (!field) return { ok: false, error: "Field not found" };

    if (
      field.reviewStatus !== "accepted" &&
      field.reviewStatus !== "edited"
    ) {
      return {
        ok: false,
        error: `Field is ${field.reviewStatus}; only accepted/edited fields can be applied`,
      };
    }
    if (!field.reviewedByUserId) {
      return { ok: false, error: "Field has no reviewer recorded" };
    }
    if (field.appliedAt) {
      return { ok: true, appliedTo: "no-op (already applied)" };
    }
    if (!field.subscriptionId) {
      return {
        ok: false,
        error: "Field is not linked to a subscription; cannot apply",
      };
    }

    const value =
      field.reviewStatus === "edited" && field.reviewerEditedValueJson
        ? field.reviewerEditedValueJson
        : field.parsedValueJson;

    const [sub] = await tx
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.id, field.subscriptionId),
          eq(subscriptionsTable.accountId, input.accountId)
        )
      )
      .limit(1);
    if (!sub) return { ok: false, error: "Subscription not found" };

    let appliedTo = "subscription";
    let beforeSnapshot: Record<string, unknown> = {};
    let afterSnapshot: Record<string, unknown> = {};

    switch (field.fieldKey) {
      case "renewal_date": {
        const v = value as { date?: string } | null;
        if (!v?.date) return { ok: false, error: "No date to apply" };
        beforeSnapshot = { termEndDate: sub.termEndDate };
        afterSnapshot = { termEndDate: v.date };
        const noticeDeadline = calculateNoticeDeadline(
          v.date,
          sub.noticePeriodDays
        )
          .toISOString()
          .split("T")[0]!;
        await tx
          .update(subscriptionsTable)
          .set({ termEndDate: v.date })
          .where(eq(subscriptionsTable.id, sub.id));
        await tx
          .update(renewalEventsTable)
          .set({
            renewalDate: v.date,
            noticeDeadline,
            status: "upcoming",
          })
          .where(eq(renewalEventsTable.subscriptionId, sub.id));
        appliedTo = "subscription + renewal_event";
        break;
      }
      case "notice_period_days": {
        const v = value as { days?: number } | null;
        if (typeof v?.days !== "number")
          return { ok: false, error: "No notice period to apply" };
        beforeSnapshot = { noticePeriodDays: sub.noticePeriodDays };
        afterSnapshot = { noticePeriodDays: v.days };
        const noticeDeadline = calculateNoticeDeadline(
          sub.termEndDate,
          v.days
        )
          .toISOString()
          .split("T")[0]!;
        await tx
          .update(subscriptionsTable)
          .set({ noticePeriodDays: v.days })
          .where(eq(subscriptionsTable.id, sub.id));
        await tx
          .update(renewalEventsTable)
          .set({ noticeDeadline, status: "upcoming" })
          .where(eq(renewalEventsTable.subscriptionId, sub.id));
        appliedTo = "subscription + renewal_event";
        break;
      }
      case "auto_renewal": {
        const v = value as { yes?: boolean } | null;
        if (typeof v?.yes !== "boolean")
          return { ok: false, error: "No auto-renew value to apply" };
        beforeSnapshot = { autoRenew: sub.autoRenew };
        afterSnapshot = { autoRenew: v.yes };
        await tx
          .update(subscriptionsTable)
          .set({ autoRenew: v.yes })
          .where(eq(subscriptionsTable.id, sub.id));
        break;
      }
      case "contract_value_cents": {
        const v = value as { cents?: number } | null;
        if (typeof v?.cents !== "number")
          return { ok: false, error: "No contract value to apply" };
        const newTotal = v.cents;
        const newUnit = Math.round(newTotal / Math.max(1, sub.totalSeats));
        beforeSnapshot = {
          totalCostPerPeriodCents: sub.totalCostPerPeriodCents,
          unitPriceCents: sub.unitPriceCents,
        };
        afterSnapshot = {
          totalCostPerPeriodCents: newTotal,
          unitPriceCents: newUnit,
        };
        await tx
          .update(subscriptionsTable)
          .set({
            totalCostPerPeriodCents: newTotal,
            unitPriceCents: newUnit,
          })
          .where(eq(subscriptionsTable.id, sub.id));
        break;
      }
      case "price_increase_clause": {
        const v = value as { clause?: string } | null;
        if (!v?.clause)
          return { ok: false, error: "No clause text to apply" };
        const stamp = `[Price increase clause from contract] ${v.clause}`;
        const newNotes = sub.notes ? `${sub.notes}\n\n${stamp}` : stamp;
        beforeSnapshot = { notes: sub.notes };
        afterSnapshot = { notes: newNotes };
        await tx
          .update(subscriptionsTable)
          .set({ notes: newNotes })
          .where(eq(subscriptionsTable.id, sub.id));
        break;
      }
      case "cancellation_method": {
        const v = value as { method?: string } | null;
        if (!v?.method)
          return { ok: false, error: "No cancellation method to apply" };
        const [vendor] = await tx
          .select()
          .from(vendorsTable)
          .where(eq(vendorsTable.id, sub.vendorId))
          .limit(1);
        if (!vendor) return { ok: false, error: "Vendor not found" };
        const stamp = `Cancellation method per contract: ${v.method}`;
        const newNotes = vendor.cancellationNotes
          ? `${vendor.cancellationNotes}\n\n${stamp}`
          : stamp;
        beforeSnapshot = { cancellationNotes: vendor.cancellationNotes };
        afterSnapshot = { cancellationNotes: newNotes };
        await tx
          .update(vendorsTable)
          .set({ cancellationNotes: newNotes })
          .where(eq(vendorsTable.id, vendor.id));
        appliedTo = "vendor";
        break;
      }
    }

    // Flip the field to "applied" + record when it was applied.
    await tx
      .update(aiExtractedFieldsTable)
      .set({ reviewStatus: "applied", appliedAt: new Date() })
      .where(eq(aiExtractedFieldsTable.id, field.id));

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.extractedFieldApplied,
      target: { entityType: appliedTo.split(" + ")[0]!, entityId: sub.id },
      before: beforeSnapshot,
      after: {
        ...afterSnapshot,
        appliedFromExtractedFieldId: field.id,
        appliedFromDocumentId: field.documentId,
      },
    });

    return { ok: true as const, appliedTo };
  });
}

/**
 * Update review state without applying. Pure metadata change.
 *
 * - "accepted": user approves the AI value as-is
 * - "edited":   user changes the value before approving
 * - "rejected": user discards the field
 *
 * Apply happens in a separate step via `applyExtractedField` so the review
 * UX can collect a batch first.
 */
export async function reviewExtractedField(input: {
  accountId: string;
  actorUserId: string;
  fieldId: string;
  decision: "accepted" | "edited" | "rejected";
  editedValueJson?: Record<string, unknown> | null;
}): Promise<{ ok: true; field: AiExtractedField } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(aiExtractedFieldsTable)
      .where(
        and(
          eq(aiExtractedFieldsTable.id, input.fieldId),
          eq(aiExtractedFieldsTable.accountId, input.accountId)
        )
      )
      .limit(1);
    if (!existing) return { ok: false, error: "Field not found" };
    // Only pending/accepted/edited/rejected fields can be re-reviewed.
    // Applied fields are immutable.
    const status: string = existing.reviewStatus;
    if (status === "applied") {
      return { ok: false, error: "Field already applied — cannot re-review" };
    }
    if (
      status !== "pending" &&
      status !== "accepted" &&
      status !== "edited" &&
      status !== "rejected"
    ) {
      return {
        ok: false,
        error: `Field is ${status}; not reviewable`,
      };
    }

    const [updated] = await tx
      .update(aiExtractedFieldsTable)
      .set({
        reviewStatus: input.decision,
        reviewedByUserId: input.actorUserId,
        reviewedAt: new Date(),
        reviewerEditedValueJson:
          input.decision === "edited" ? input.editedValueJson ?? null : null,
      })
      .where(eq(aiExtractedFieldsTable.id, existing.id))
      .returning();
    if (!updated) return { ok: false, error: "Update failed" };

    const action =
      input.decision === "accepted"
        ? AUDIT_ACTIONS.extractedFieldAccepted
        : input.decision === "edited"
          ? AUDIT_ACTIONS.extractedFieldEdited
          : AUDIT_ACTIONS.extractedFieldRejected;
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action,
      target: { entityType: "ai_extracted_field", entityId: existing.id },
      before: { reviewStatus: existing.reviewStatus },
      after: {
        reviewStatus: input.decision,
        editedValueJson: input.editedValueJson,
      },
    });

    return { ok: true as const, field: updated };
  });
}
