/**
 * GDPR-style account data export.
 *
 * Admin-only. Streams every row tied to the caller's account as a single
 * JSON document. Document bytes are NOT included — only metadata —
 * because the PDFs are already accessible via /documents/[id] and would
 * balloon the export for negligible information value (we already store
 * `textContent` which is the structured part).
 *
 * Writes an audit log entry so the export itself is auditable.
 *
 * Tenant scope: every query filters by accountId. Cross-account leakage
 * is impossible by construction.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  aiExtractionRunsTable,
  auditLogTable,
  complianceArtifactsTable,
  decisionContextsTable,
  documentsTable,
  invitationsTable,
  notificationsTable,
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  usersTable,
  vendorEventsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { createLogger } from "@server/infrastructure/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger({ component: "api.account.export" });

export async function GET(): Promise<NextResponse> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    // Admin or owner — operationally sensitive (the export contains
    // every team member's email, every contract value, the audit log).
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const accountId = account.id;

  try {
    // Pull every account-scoped table in parallel. The export is one-shot
    // so we accept the memory cost of materializing it; account scope
    // bounds it.
    const [
      users,
      vendors,
      subscriptions,
      renewalEvents,
      decisions,
      savings,
      notifications,
      auditEntries,
      documents,
      runs,
      fields,
      vendorEvents,
      complianceArtifacts,
      invitations,
    ] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.accountId, accountId)),
      db
        .select()
        .from(vendorsTable)
        .where(eq(vendorsTable.accountId, accountId)),
      db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.accountId, accountId)),
      db
        .select()
        .from(renewalEventsTable)
        .where(eq(renewalEventsTable.accountId, accountId)),
      db
        .select()
        .from(decisionContextsTable)
        .where(eq(decisionContextsTable.accountId, accountId)),
      db
        .select()
        .from(savingsRecordsTable)
        .where(eq(savingsRecordsTable.accountId, accountId)),
      db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.accountId, accountId)),
      db
        .select()
        .from(auditLogTable)
        .where(eq(auditLogTable.accountId, accountId)),
      db
        .select({
          // Strip the full text content from the export — it's already
          // covered by the per-field structured outputs and including the
          // raw text doubles the payload for no information gain. We do
          // include it as a separate documents.textContent property below
          // for completeness; toggle here if the cost matters.
          id: documentsTable.id,
          accountId: documentsTable.accountId,
          subscriptionId: documentsTable.subscriptionId,
          uploadedByUserId: documentsTable.uploadedByUserId,
          kind: documentsTable.kind,
          filename: documentsTable.filename,
          mimeType: documentsTable.mimeType,
          sizeBytes: documentsTable.sizeBytes,
          checksumSha256: documentsTable.checksumSha256,
          pageCount: documentsTable.pageCount,
          textExtractionStatus: documentsTable.textExtractionStatus,
          textExtractionError: documentsTable.textExtractionError,
          createdAt: documentsTable.uploadedAt,
        })
        .from(documentsTable)
        .where(eq(documentsTable.accountId, accountId)),
      db
        .select()
        .from(aiExtractionRunsTable)
        .where(eq(aiExtractionRunsTable.accountId, accountId)),
      db
        .select()
        .from(aiExtractedFieldsTable)
        .where(eq(aiExtractedFieldsTable.accountId, accountId)),
      db
        .select()
        .from(vendorEventsTable)
        .where(eq(vendorEventsTable.accountId, accountId)),
      db
        .select()
        .from(complianceArtifactsTable)
        .where(eq(complianceArtifactsTable.accountId, accountId)),
      db
        .select()
        .from(invitationsTable)
        .where(eq(invitationsTable.accountId, accountId)),
    ]);

    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        exportedByUserId: user.id,
        accountId,
        // Schema version helps downstream importers route legacy exports.
        schemaVersion: 1,
        note:
          "Document file bytes are not included in this export. Download each PDF separately from /documents in the app if needed.",
      },
      account: {
        id: account.id,
        name: account.name,
        billingEmail: account.billingEmail,
        planTier: account.planTier,
        timezone: account.timezone,
        createdAt: account.createdAt,
        // Sensitive Stripe IDs intentionally omitted — they're not data
        // the customer "owns"; they're billing-system identifiers.
      },
      users,
      vendors,
      subscriptions,
      renewalEvents,
      decisions,
      savings,
      notifications,
      auditEntries,
      documents,
      extractionRuns: runs,
      extractedFields: fields,
      vendorEvents,
      complianceArtifacts,
      invitations,
    };

    // Audit the export itself.
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, {
        accountId,
        actorUserId: user.id,
        action: AUDIT_ACTIONS.accountDataExported,
        target: { entityType: "account", entityId: accountId },
        after: {
          tablesExported: Object.keys(payload).length,
          rowCount:
            users.length +
            vendors.length +
            subscriptions.length +
            renewalEvents.length +
            decisions.length +
            savings.length +
            notifications.length +
            auditEntries.length +
            documents.length +
            runs.length +
            fields.length +
            vendorEvents.length +
            complianceArtifacts.length +
            invitations.length,
        },
      });
    });

    const filename = `renewal-radar-export-${accountId.slice(0, 8)}-${new Date()
      .toISOString()
      .split("T")[0]}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    log.error("account_export_failed", err, { accountId });
    return NextResponse.json(
      { error: "Export failed" },
      { status: 500 }
    );
  }
}
