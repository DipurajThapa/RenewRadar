import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  documentsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type { Document } from "@server/infrastructure/db/schema";

export type DocumentRow = Document & {
  vendorName: string | null;
  productName: string | null;
  pendingFieldCount: number;
};

/**
 * Documents belonging to an account, optionally filtered to a subscription.
 * Joined to subscription/vendor so the UI can show "Atlassian — Jira" without
 * a second round-trip, plus a count of pending review fields per document.
 */
export async function listDocuments(
  accountId: string,
  filters: { subscriptionId?: string } = {}
): Promise<DocumentRow[]> {
  const conditions = [eq(documentsTable.accountId, accountId)];
  if (filters.subscriptionId) {
    conditions.push(eq(documentsTable.subscriptionId, filters.subscriptionId));
  }

  const docs = await db
    .select({
      document: documentsTable,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
    })
    .from(documentsTable)
    .leftJoin(
      subscriptionsTable,
      eq(documentsTable.subscriptionId, subscriptionsTable.id)
    )
    .leftJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(and(...conditions))
    .orderBy(desc(documentsTable.uploadedAt));

  // Cheap second query to count pending fields per document. At V1 scale this
  // is a single grouped SELECT — well under 100ms for the largest account.
  const fieldCounts = await db
    .select({
      documentId: aiExtractedFieldsTable.documentId,
    })
    .from(aiExtractedFieldsTable)
    .where(
      and(
        eq(aiExtractedFieldsTable.accountId, accountId),
        eq(aiExtractedFieldsTable.reviewStatus, "pending")
      )
    );
  const pendingByDoc = new Map<string, number>();
  for (const row of fieldCounts) {
    pendingByDoc.set(
      row.documentId,
      (pendingByDoc.get(row.documentId) ?? 0) + 1
    );
  }

  return docs.map(({ document, vendorName, productName }) => ({
    ...document,
    vendorName,
    productName,
    pendingFieldCount: pendingByDoc.get(document.id) ?? 0,
  }));
}

export async function getDocument(
  accountId: string,
  documentId: string
): Promise<Document | null> {
  const rows = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, documentId),
        eq(documentsTable.accountId, accountId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Latest documents for a given subscription, used by the subscription detail
 * page to show "Attached contracts."
 */
export async function listDocumentsForSubscription(
  accountId: string,
  subscriptionId: string
): Promise<Document[]> {
  return db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.accountId, accountId),
        eq(documentsTable.subscriptionId, subscriptionId)
      )
    )
    .orderBy(asc(documentsTable.uploadedAt));
}
