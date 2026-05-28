/**
 * Compliance artifact use cases.
 *
 * NOT legal review. Record-keeping: what document on file, who received it,
 * when does it expire. The legal status of each artifact remains the
 * customer's (and their counsel's) responsibility.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  complianceArtifactsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type {
  ComplianceArtifact,
  ComplianceArtifactKind,
} from "@server/infrastructure/db/schema";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";

export class ComplianceArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComplianceArtifactError";
  }
}

export type UpsertComplianceArtifactInput = {
  accountId: string;
  actorUserId: string;
  vendorId: string;
  kind: ComplianceArtifactKind;
  receivedAt?: Date | null;
  expiresAt?: Date | null;
  documentId?: string | null;
  note?: string | null;
};

/**
 * Idempotent per (account, vendor, kind). Re-recording a DPA replaces the
 * row; the vendor event log shows both received-events.
 */
export async function upsertComplianceArtifact(
  input: UpsertComplianceArtifactInput
): Promise<ComplianceArtifact> {
  return db.transaction(async (tx) => {
    const [vendor] = await tx
      .select()
      .from(vendorsTable)
      .where(
        and(
          eq(vendorsTable.id, input.vendorId),
          eq(vendorsTable.accountId, input.accountId)
        )
      )
      .limit(1);
    if (!vendor) {
      throw new ComplianceArtifactError("Vendor not found in this account");
    }

    const [existing] = await tx
      .select()
      .from(complianceArtifactsTable)
      .where(
        and(
          eq(complianceArtifactsTable.accountId, input.accountId),
          eq(complianceArtifactsTable.vendorId, input.vendorId),
          eq(complianceArtifactsTable.kind, input.kind)
        )
      )
      .limit(1);

    let row: ComplianceArtifact;
    if (existing) {
      const [updated] = await tx
        .update(complianceArtifactsTable)
        .set({
          receivedAt: input.receivedAt ?? existing.receivedAt,
          expiresAt: input.expiresAt ?? existing.expiresAt,
          documentId: input.documentId ?? existing.documentId,
          note: input.note ?? existing.note,
        })
        .where(eq(complianceArtifactsTable.id, existing.id))
        .returning();
      if (!updated) throw new ComplianceArtifactError("Update failed");
      row = updated;
    } else {
      const [created] = await tx
        .insert(complianceArtifactsTable)
        .values({
          accountId: input.accountId,
          vendorId: input.vendorId,
          kind: input.kind,
          receivedAt: input.receivedAt ?? null,
          expiresAt: input.expiresAt ?? null,
          documentId: input.documentId ?? null,
          note: input.note ?? null,
          createdByUserId: input.actorUserId,
        })
        .returning();
      if (!created) throw new ComplianceArtifactError("Insert failed");
      row = created;
    }

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: existing
        ? AUDIT_ACTIONS.integrationConfigured // reused (no dedicated compliance action enum yet)
        : AUDIT_ACTIONS.integrationConfigured,
      target: { entityType: "compliance_artifact", entityId: row.id },
      after: {
        kind: row.kind,
        receivedAt: row.receivedAt,
        expiresAt: row.expiresAt,
        documentId: row.documentId,
      },
    });

    // Vendor memory — receipt of a compliance doc is timeline-worthy.
    if (input.receivedAt) {
      // Find the first active subscription with this vendor (if any) so the
      // event can link back; null is fine.
      const [activeSub] = await tx
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.accountId, input.accountId),
            eq(subscriptionsTable.vendorId, input.vendorId)
          )
        )
        .limit(1);

      await recordVendorEvent(tx, {
        accountId: input.accountId,
        vendorId: input.vendorId,
        subscriptionId: activeSub?.id ?? null,
        kind: "compliance_doc_received",
        payload: {
          artifactKind: input.kind,
          receivedAt: input.receivedAt.toISOString(),
          expiresAt: input.expiresAt?.toISOString() ?? null,
          documentId: input.documentId ?? null,
        },
        actorUserId: input.actorUserId,
        relatedEntityType: "compliance_artifact",
        relatedEntityId: row.id,
      });
    }

    return row;
  });
}

export async function deleteComplianceArtifact(input: {
  accountId: string;
  actorUserId: string;
  artifactId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(complianceArtifactsTable)
      .where(
        and(
          eq(complianceArtifactsTable.id, input.artifactId),
          eq(complianceArtifactsTable.accountId, input.accountId)
        )
      )
      .limit(1);
    if (!existing) return;
    await tx
      .delete(complianceArtifactsTable)
      .where(eq(complianceArtifactsTable.id, existing.id));
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.integrationDisabled, // reused; not a security-critical action
      target: { entityType: "compliance_artifact", entityId: existing.id },
      before: {
        kind: existing.kind,
        receivedAt: existing.receivedAt,
        expiresAt: existing.expiresAt,
      },
    });
  });
}
