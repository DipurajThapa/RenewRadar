import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  aiExtractionRunsTable,
  documentsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type {
  AiExtractedField,
  AiExtractionRun,
} from "@server/infrastructure/db/schema";

export type PendingReviewField = AiExtractedField & {
  documentFilename: string;
  vendorName: string | null;
  productName: string | null;
  /** Current value on the subscription, when one is linked. For the diff UI. */
  subscriptionCurrentValueJson: unknown;
};

/**
 * Fields awaiting human review across the account, oldest first.
 *
 * Surfacing oldest first reflects the operational reality: a field that's
 * been waiting two days should be reviewed before a field that just landed.
 */
export async function listPendingReviewFields(
  accountId: string
): Promise<PendingReviewField[]> {
  const rows = await db
    .select({
      field: aiExtractedFieldsTable,
      documentFilename: documentsTable.filename,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      currentNoticePeriod: subscriptionsTable.noticePeriodDays,
      currentAutoRenew: subscriptionsTable.autoRenew,
      currentTermEnd: subscriptionsTable.termEndDate,
      currentUnitPrice: subscriptionsTable.unitPriceCents,
      currentTotalCost: subscriptionsTable.totalCostPerPeriodCents,
    })
    .from(aiExtractedFieldsTable)
    .innerJoin(
      documentsTable,
      eq(aiExtractedFieldsTable.documentId, documentsTable.id)
    )
    .leftJoin(
      subscriptionsTable,
      eq(aiExtractedFieldsTable.subscriptionId, subscriptionsTable.id)
    )
    .leftJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(aiExtractedFieldsTable.accountId, accountId),
        eq(aiExtractedFieldsTable.reviewStatus, "pending")
      )
    )
    .orderBy(asc(aiExtractedFieldsTable.createdAt));

  return rows.map((r) => ({
    ...r.field,
    documentFilename: r.documentFilename,
    vendorName: r.vendorName,
    productName: r.productName,
    subscriptionCurrentValueJson: pickCurrentValue(r.field.fieldKey, {
      noticePeriodDays: r.currentNoticePeriod,
      autoRenew: r.currentAutoRenew,
      termEndDate: r.currentTermEnd,
      unitPriceCents: r.currentUnitPrice,
      totalCostPerPeriodCents: r.currentTotalCost,
    }),
  }));
}

export type AutoAppliedField = AiExtractedField & {
  documentFilename: string;
  vendorName: string | null;
  productName: string | null;
};

/**
 * Fields the AI auto-applied without human review (reviewStatus "applied" with
 * NO human reviewer). These are the rows behind the conservative auto-apply
 * policy's one-click undo. Newest first.
 */
export async function listAutoAppliedFields(
  accountId: string
): Promise<AutoAppliedField[]> {
  const rows = await db
    .select({
      field: aiExtractedFieldsTable,
      documentFilename: documentsTable.filename,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
    })
    .from(aiExtractedFieldsTable)
    .innerJoin(
      documentsTable,
      eq(aiExtractedFieldsTable.documentId, documentsTable.id)
    )
    .leftJoin(
      subscriptionsTable,
      eq(aiExtractedFieldsTable.subscriptionId, subscriptionsTable.id)
    )
    .leftJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(aiExtractedFieldsTable.accountId, accountId),
        eq(aiExtractedFieldsTable.reviewStatus, "applied"),
        isNull(aiExtractedFieldsTable.reviewedByUserId)
      )
    )
    .orderBy(desc(aiExtractedFieldsTable.appliedAt));

  return rows.map((r) => ({
    ...r.field,
    documentFilename: r.documentFilename,
    vendorName: r.vendorName,
    productName: r.productName,
  }));
}

/** Count of pending review fields — used for the nav badge. */
export async function countPendingReviewFields(
  accountId: string
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiExtractedFieldsTable)
    .where(
      and(
        eq(aiExtractedFieldsTable.accountId, accountId),
        eq(aiExtractedFieldsTable.reviewStatus, "pending")
      )
    );
  return result[0]?.count ?? 0;
}

export async function getExtractionRun(
  accountId: string,
  runId: string
): Promise<AiExtractionRun | null> {
  const rows = await db
    .select()
    .from(aiExtractionRunsTable)
    .where(
      and(
        eq(aiExtractionRunsTable.id, runId),
        eq(aiExtractionRunsTable.accountId, accountId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listExtractedFieldsForDocument(
  accountId: string,
  documentId: string
): Promise<AiExtractedField[]> {
  return db
    .select()
    .from(aiExtractedFieldsTable)
    .where(
      and(
        eq(aiExtractedFieldsTable.accountId, accountId),
        eq(aiExtractedFieldsTable.documentId, documentId)
      )
    )
    .orderBy(asc(aiExtractedFieldsTable.fieldKey));
}

/**
 * Sum of `pagesCharged` for runs in the current calendar month. Used to
 * enforce the tier's `aiExtractionPagesPerMonth` cap before kicking off a
 * new run.
 *
 * Counts BOTH `running` and `succeeded` runs — running rows are
 * pre-reserved by `reserveAiPagesBudget` so the race condition where 50
 * concurrent extracts all read 0 and bypass the cap can no longer happen.
 * A failed run is excluded (it didn't consume the budget).
 */
export async function getMonthlyPagesUsed(accountId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      pages: sql<number>`coalesce(sum(${aiExtractionRunsTable.pagesCharged}), 0)::int`,
    })
    .from(aiExtractionRunsTable)
    .where(
      and(
        eq(aiExtractionRunsTable.accountId, accountId),
        gte(aiExtractionRunsTable.startedAt, monthStart),
        sql`${aiExtractionRunsTable.status} in ('running', 'succeeded')`
      )
    );
  return rows[0]?.pages ?? 0;
}

function pickCurrentValue(
  fieldKey: AiExtractedField["fieldKey"],
  current: {
    noticePeriodDays: number | null;
    autoRenew: boolean | null;
    termEndDate: string | null;
    unitPriceCents: number | null;
    totalCostPerPeriodCents: number | null;
  }
): unknown {
  switch (fieldKey) {
    case "renewal_date":
      return current.termEndDate ? { date: current.termEndDate } : null;
    case "notice_period_days":
      return current.noticePeriodDays !== null
        ? { days: current.noticePeriodDays }
        : null;
    case "auto_renewal":
      return current.autoRenew !== null ? { yes: current.autoRenew } : null;
    case "contract_value_cents":
      return current.totalCostPerPeriodCents !== null
        ? { cents: current.totalCostPerPeriodCents, currency: "USD" }
        : null;
    case "price_increase_clause":
    case "cancellation_method":
      return null;
  }
}
