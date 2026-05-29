/**
 * T4.10 Slice 2 — Vendor domain verification.
 *
 * Flow:
 *   1. `startDomainVerification` mints (or reuses) a pending verification
 *      with a public token, and returns the DNS TXT record the vendor must
 *      publish: host `_renewalradar.<domain>`, value `renewalradar-verify=<token>`.
 *   2. The vendor adds that record, then triggers `checkDomainVerification`,
 *      which resolves the TXT records and, on a match, marks the verification
 *      `verified` and flips the parent `vendor_org` to `active` +
 *      `domainVerifiedAt`.
 *   3. `manuallyVerifyDomain` is the staff break-glass (method = 'manual').
 *
 * Guard: the org only transitions pending → active. A suspended or archived
 * org never becomes active through verification.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  vendorDomainVerificationsTable,
  vendorOrgsTable,
  type VendorDomainVerification,
  type VendorOrg,
} from "@server/infrastructure/db/schema";
import {
  VENDOR_AUDIT_ACTIONS,
  writeVendorAuditLog,
} from "@server/infrastructure/vendor-audit-log/writer";
import { getDnsResolver } from "@server/infrastructure/dns";
import { generateOpaqueToken } from "./internals";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "vendor-domain-verification" });

export class DomainVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainVerificationError";
  }
}

/** The DNS host the vendor publishes the TXT record at. */
export function verificationHost(domain: string): string {
  return `_renewalradar.${domain}`;
}

/** The exact TXT value we look for. */
export function expectedTxtValue(token: string): string {
  return `renewalradar-verify=${token}`;
}

async function loadOrg(vendorOrgId: string): Promise<VendorOrg> {
  const [org] = await db
    .select()
    .from(vendorOrgsTable)
    .where(eq(vendorOrgsTable.id, vendorOrgId))
    .limit(1);
  if (!org) throw new DomainVerificationError("Vendor org not found.");
  return org;
}

export type StartVerificationResult = {
  verification: VendorDomainVerification;
  host: string;
  expectedValue: string;
  alreadyVerified: boolean;
};

/**
 * Begin (or resume) DNS verification. Idempotent: reuses an existing pending
 * row so the vendor doesn't have to swap the TXT value on every visit.
 */
export async function startDomainVerification(input: {
  vendorOrgId: string;
  vendorUserId: string;
}): Promise<StartVerificationResult> {
  const org = await loadOrg(input.vendorOrgId);

  if (org.domainVerifiedAt) {
    const [verified] = await db
      .select()
      .from(vendorDomainVerificationsTable)
      .where(
        and(
          eq(vendorDomainVerificationsTable.vendorOrgId, org.id),
          eq(vendorDomainVerificationsTable.status, "verified")
        )
      )
      .orderBy(desc(vendorDomainVerificationsTable.verifiedAt))
      .limit(1);
    if (verified) {
      return {
        verification: verified,
        host: verificationHost(verified.domain),
        expectedValue: expectedTxtValue(verified.token),
        alreadyVerified: true,
      };
    }
  }

  // Reuse an existing pending row if present.
  const [pending] = await db
    .select()
    .from(vendorDomainVerificationsTable)
    .where(
      and(
        eq(vendorDomainVerificationsTable.vendorOrgId, org.id),
        eq(vendorDomainVerificationsTable.status, "pending")
      )
    )
    .orderBy(desc(vendorDomainVerificationsTable.createdAt))
    .limit(1);

  if (pending) {
    return {
      verification: pending,
      host: verificationHost(pending.domain),
      expectedValue: expectedTxtValue(pending.token),
      alreadyVerified: false,
    };
  }

  const token = generateOpaqueToken();
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(vendorDomainVerificationsTable)
      .values({
        vendorOrgId: org.id,
        domain: org.primaryDomain,
        method: "dns_txt",
        status: "pending",
        token,
      })
      .returning();
    if (!created) {
      throw new DomainVerificationError("Failed to create verification.");
    }
    await writeVendorAuditLog(tx, {
      vendorOrgId: org.id,
      actorVendorUserId: input.vendorUserId,
      action: VENDOR_AUDIT_ACTIONS.vendorDomainVerificationStarted,
      target: {
        entityType: "vendor_domain_verification",
        entityId: created.id,
      },
      after: { domain: created.domain, host: verificationHost(created.domain) },
    });
    return {
      verification: created,
      host: verificationHost(created.domain),
      expectedValue: expectedTxtValue(created.token),
      alreadyVerified: false,
    };
  });
}

export type CheckVerificationResult = {
  verified: boolean;
  /** TXT records we observed at the host (for debugging the UI). */
  observed: string[];
  host: string;
  expectedValue: string;
};

/**
 * Resolve the TXT records and, on a match, mark the org verified. Increments
 * attempts + stamps lastCheckedAt either way.
 */
export async function checkDomainVerification(input: {
  vendorOrgId: string;
  vendorUserId: string;
}): Promise<CheckVerificationResult> {
  const org = await loadOrg(input.vendorOrgId);

  const [pending] = await db
    .select()
    .from(vendorDomainVerificationsTable)
    .where(
      and(
        eq(vendorDomainVerificationsTable.vendorOrgId, org.id),
        eq(vendorDomainVerificationsTable.status, "pending")
      )
    )
    .orderBy(desc(vendorDomainVerificationsTable.createdAt))
    .limit(1);

  if (!pending) {
    // Nothing pending — either already verified or never started.
    const host = verificationHost(org.primaryDomain);
    return {
      verified: org.domainVerifiedAt !== null,
      observed: [],
      host,
      expectedValue: "",
    };
  }

  const host = verificationHost(pending.domain);
  const expected = expectedTxtValue(pending.token);
  const observed = await getDnsResolver().resolveTxt(host);
  const matched = observed.some((r) => r.trim() === expected);

  if (!matched) {
    await db
      .update(vendorDomainVerificationsTable)
      .set({
        attempts: pending.attempts + 1,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorDomainVerificationsTable.id, pending.id));
    log.info("vendor_domain_check_miss", {
      vendorOrgId: org.id,
      host,
      observedCount: observed.length,
    });
    return { verified: false, observed, host, expectedValue: expected };
  }

  // Match — verify, in a transaction with the org flip + audit.
  await db.transaction(async (tx) => {
    await tx
      .update(vendorDomainVerificationsTable)
      .set({
        status: "verified",
        verifiedAt: new Date(),
        attempts: pending.attempts + 1,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorDomainVerificationsTable.id, pending.id));

    // Only flip pending → active. Never resurrect suspended/archived.
    if (org.status === "pending") {
      await tx
        .update(vendorOrgsTable)
        .set({ status: "active", domainVerifiedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(vendorOrgsTable.id, org.id),
            eq(vendorOrgsTable.status, "pending")
          )
        );
    } else {
      // Already active or otherwise — just stamp domainVerifiedAt if unset.
      await tx
        .update(vendorOrgsTable)
        .set({ domainVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(vendorOrgsTable.id, org.id));
    }

    await writeVendorAuditLog(tx, {
      vendorOrgId: org.id,
      actorVendorUserId: input.vendorUserId,
      action: VENDOR_AUDIT_ACTIONS.vendorDomainVerified,
      target: {
        entityType: "vendor_domain_verification",
        entityId: pending.id,
      },
      after: { domain: pending.domain, method: "dns_txt" },
    });
  });

  log.info("vendor_domain_verified", { vendorOrgId: org.id, host });
  return { verified: true, observed, host, expectedValue: expected };
}

/**
 * Staff break-glass: mark a vendor org's domain verified without DNS.
 * Records method = 'manual' and the staff note.
 */
export async function manuallyVerifyDomain(input: {
  vendorOrgId: string;
  note: string;
}): Promise<VendorOrg> {
  const org = await loadOrg(input.vendorOrgId);
  if (org.status === "archived") {
    throw new DomainVerificationError("Cannot verify an archived vendor org.");
  }

  return db.transaction(async (tx) => {
    const [verification] = await tx
      .insert(vendorDomainVerificationsTable)
      .values({
        vendorOrgId: org.id,
        domain: org.primaryDomain,
        method: "manual",
        status: "verified",
        token: "manual",
        verifiedAt: new Date(),
        verifierNote: input.note,
      })
      .returning();

    const [updated] = await tx
      .update(vendorOrgsTable)
      .set({
        status: org.status === "suspended" ? "suspended" : "active",
        domainVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorOrgsTable.id, org.id))
      .returning();

    await writeVendorAuditLog(tx, {
      vendorOrgId: org.id,
      actorVendorUserId: null,
      action: VENDOR_AUDIT_ACTIONS.vendorDomainVerifiedManually,
      target: {
        entityType: "vendor_domain_verification",
        entityId: verification?.id ?? org.id,
      },
      after: { note: input.note },
    });

    return updated ?? org;
  });
}

export async function getLatestVerification(
  vendorOrgId: string
): Promise<VendorDomainVerification | null> {
  const [row] = await db
    .select()
    .from(vendorDomainVerificationsTable)
    .where(eq(vendorDomainVerificationsTable.vendorOrgId, vendorOrgId))
    .orderBy(desc(vendorDomainVerificationsTable.createdAt))
    .limit(1);
  return row ?? null;
}
