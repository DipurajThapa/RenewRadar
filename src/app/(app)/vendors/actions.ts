"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  ComplianceArtifactError,
  deleteComplianceArtifact,
  upsertComplianceArtifact,
} from "@server/application/compliance";
import {
  blockVendor,
  findMatchingVendorOrg,
  requestConnection,
  VendorConnectionError,
} from "@server/application/vendor-portal/connections";
import type { ComplianceArtifactKind } from "@server/infrastructure/db/schema";

export type ComplianceActionResult =
  | { ok: true }
  | { ok: false; error: string };

const recordSchema = z.object({
  vendorId: z.string().uuid(),
  kind: z.enum([
    "dpa",
    "msa",
    "nda",
    "soc2_type_ii_report",
    "soc2_type_i_report",
    "iso_27001",
    "iso_27018",
    "iso_27701",
    "hipaa_baa",
    "pci_aoc",
    "gdpr_addendum",
    "insurance_certificate",
    "w9",
    "w8_ben_e",
    "vendor_security_questionnaire",
    "subprocessor_list",
    "penetration_test_summary",
    "incident_response_plan",
    "other",
  ]),
  receivedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

export async function recordComplianceArtifactAction(input: {
  vendorId: string;
  kind: string;
  receivedAt: string | null;
  expiresAt: string | null;
  note: string | null;
}): Promise<ComplianceActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    await upsertComplianceArtifact({
      accountId: account.id,
      actorUserId: user.id,
      vendorId: parsed.data.vendorId,
      kind: parsed.data.kind as ComplianceArtifactKind,
      receivedAt: parsed.data.receivedAt
        ? new Date(parsed.data.receivedAt)
        : null,
      expiresAt: parsed.data.expiresAt
        ? new Date(parsed.data.expiresAt)
        : null,
      note: parsed.data.note ?? null,
    });
  } catch (err) {
    if (err instanceof ComplianceArtifactError) {
      return { ok: false, error: err.message };
    }
    console.error("[recordComplianceArtifactAction] failed:", err);
    return { ok: false, error: "Server error" };
  }

  revalidatePath(`/vendors/${parsed.data.vendorId}`);
  return { ok: true };
}

// ─── T4.10 Slice 3 — Vendor portal connections ────────────────────────────

export type ConnectionActionResult = { ok: true } | { ok: false; error: string };

/**
 * Customer requests a connection to the verified vendor_org matching this
 * vendor row. Reveals the account to the vendor — so admin+ only.
 */
export async function requestVendorConnectionAction(
  customerVendorId: string
): Promise<ConnectionActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    const match = await findMatchingVendorOrg({
      accountId: account.id,
      customerVendorId,
    });
    if (!match) {
      return {
        ok: false,
        error: "No verified vendor on Renewal Radar matches this vendor.",
      };
    }
    await requestConnection({
      accountId: account.id,
      vendorOrgId: match.vendorOrg.id,
      customerVendorId,
      requestedByUserId: user.id,
    });
  } catch (err) {
    if (err instanceof VendorConnectionError) return { ok: false, error: err.message };
    console.error("[requestVendorConnectionAction] failed:", err);
    return { ok: false, error: "Server error" };
  }
  revalidatePath(`/vendors/${customerVendorId}`);
  return { ok: true };
}

/** Customer blocks a vendor org — stops all future deliveries. admin+ only. */
export async function blockVendorConnectionAction(input: {
  vendorOrgId: string;
  customerVendorId: string;
}): Promise<ConnectionActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    await blockVendor({
      accountId: account.id,
      vendorOrgId: input.vendorOrgId,
      userId: user.id,
    });
  } catch (err) {
    if (err instanceof VendorConnectionError) return { ok: false, error: err.message };
    console.error("[blockVendorConnectionAction] failed:", err);
    return { ok: false, error: "Server error" };
  }
  revalidatePath(`/vendors/${input.customerVendorId}`);
  return { ok: true };
}

export async function removeComplianceArtifactAction(
  artifactId: string
): Promise<ComplianceActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    await deleteComplianceArtifact({
      accountId: account.id,
      actorUserId: user.id,
      artifactId,
    });
  } catch (err) {
    console.error("[removeComplianceArtifactAction] failed:", err);
    return { ok: false, error: "Server error" };
  }
  revalidatePath("/vendors");
  return { ok: true };
}
