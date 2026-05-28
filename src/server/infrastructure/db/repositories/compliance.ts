import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  complianceArtifactsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import type { ComplianceArtifact } from "@server/infrastructure/db/schema";

export type ComplianceArtifactRow = ComplianceArtifact & {
  vendorName: string;
};

export async function listComplianceArtifactsForVendor(
  accountId: string,
  vendorId: string
): Promise<ComplianceArtifact[]> {
  return db
    .select()
    .from(complianceArtifactsTable)
    .where(
      and(
        eq(complianceArtifactsTable.accountId, accountId),
        eq(complianceArtifactsTable.vendorId, vendorId)
      )
    )
    .orderBy(asc(complianceArtifactsTable.kind));
}

/**
 * Artifacts expiring within the next N days. Used by the alert cron to
 * warn customers before a DPA / SOC2 / insurance cert lapses.
 */
export async function listExpiringComplianceArtifacts(
  accountId: string,
  withinDays: number
): Promise<ComplianceArtifactRow[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      artifact: complianceArtifactsTable,
      vendorName: vendorsTable.name,
    })
    .from(complianceArtifactsTable)
    .innerJoin(vendorsTable, eq(complianceArtifactsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(complianceArtifactsTable.accountId, accountId),
        isNotNull(complianceArtifactsTable.expiresAt),
        gte(complianceArtifactsTable.expiresAt, now),
        lte(complianceArtifactsTable.expiresAt, cutoff)
      )
    )
    .orderBy(asc(complianceArtifactsTable.expiresAt));
  return rows.map((r) => ({ ...r.artifact, vendorName: r.vendorName }));
}
