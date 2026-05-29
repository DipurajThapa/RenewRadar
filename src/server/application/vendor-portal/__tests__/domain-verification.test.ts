/**
 * T4.10 Slice 2 — domain verification contract tests.
 *
 * Invariants:
 *   - startDomainVerification mints a public token + DNS TXT record, idempotent.
 *   - checkDomainVerification matches the published TXT → verifies the org
 *     (pending → active, domainVerifiedAt set) and audit-logs it.
 *   - A miss increments attempts + stamps lastCheckedAt, does NOT verify.
 *   - A suspended org never becomes active via verification.
 *   - manuallyVerifyDomain (staff) verifies without DNS, method='manual'.
 *
 * DNS is faked via FakeDnsResolver — no real network.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  vendorAuditLogTable,
  vendorDomainVerificationsTable,
  vendorOrgsTable,
  type VendorOrg,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  checkDomainVerification,
  expectedTxtValue,
  manuallyVerifyDomain,
  startDomainVerification,
  verificationHost,
} from "@server/application/vendor-portal/domain-verification";
import { requestMagicLink } from "@server/application/vendor-portal";
import {
  FakeDnsResolver,
  _setDnsResolverForTests,
} from "@server/infrastructure/dns";
import { VENDOR_AUDIT_ACTIONS } from "@server/infrastructure/vendor-audit-log/writer";

let fakeDns: FakeDnsResolver;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  fakeDns = new FakeDnsResolver();
  _setDnsResolverForTests(fakeDns);
});

afterEach(() => {
  _setDnsResolverForTests();
});

/** Provision a pending vendor org + admin user via the real signup path. */
async function seedVendor(email = "founder@acmesoft.io"): Promise<{
  org: VendorOrg;
  vendorUserId: string;
}> {
  const r = await requestMagicLink({ email });
  return { org: r.vendorOrg, vendorUserId: r.vendorUser.id };
}

describe("startDomainVerification", () => {
  it("mints a pending verification with a TXT record", async () => {
    const { org, vendorUserId } = await seedVendor();
    const r = await startDomainVerification({
      vendorOrgId: org.id,
      vendorUserId,
    });
    expect(r.alreadyVerified).toBe(false);
    expect(r.host).toBe(`_renewalradar.${org.primaryDomain}`);
    expect(r.expectedValue).toMatch(/^renewalradar-verify=[0-9a-f]{64}$/);
    expect(r.verification.status).toBe("pending");

    // Audit row written
    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, org.id));
    expect(audit.map((a) => a.action)).toContain(
      VENDOR_AUDIT_ACTIONS.vendorDomainVerificationStarted
    );
  });

  it("is idempotent — reuses the same pending token", async () => {
    const { org, vendorUserId } = await seedVendor();
    const a = await startDomainVerification({ vendorOrgId: org.id, vendorUserId });
    const b = await startDomainVerification({ vendorOrgId: org.id, vendorUserId });
    expect(b.verification.id).toBe(a.verification.id);
    expect(b.expectedValue).toBe(a.expectedValue);

    const rows = await db
      .select()
      .from(vendorDomainVerificationsTable)
      .where(eq(vendorDomainVerificationsTable.vendorOrgId, org.id));
    expect(rows).toHaveLength(1);
  });
});

describe("checkDomainVerification", () => {
  it("verifies when the TXT record is present and flips the org to active", async () => {
    const { org, vendorUserId } = await seedVendor();
    const started = await startDomainVerification({ vendorOrgId: org.id, vendorUserId });
    // Publish the record in our fake DNS.
    fakeDns.set(started.host, ["unrelated=foo", started.expectedValue]);

    const result = await checkDomainVerification({ vendorOrgId: org.id, vendorUserId });
    expect(result.verified).toBe(true);

    const [updated] = await db
      .select()
      .from(vendorOrgsTable)
      .where(eq(vendorOrgsTable.id, org.id));
    expect(updated?.status).toBe("active");
    expect(updated?.domainVerifiedAt).toBeInstanceOf(Date);

    const [verification] = await db
      .select()
      .from(vendorDomainVerificationsTable)
      .where(eq(vendorDomainVerificationsTable.vendorOrgId, org.id));
    expect(verification?.status).toBe("verified");
    expect(verification?.verifiedAt).toBeInstanceOf(Date);

    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, org.id));
    expect(audit.map((a) => a.action)).toContain(
      VENDOR_AUDIT_ACTIONS.vendorDomainVerified
    );
  });

  it("does not verify on a miss; increments attempts", async () => {
    const { org, vendorUserId } = await seedVendor();
    await startDomainVerification({ vendorOrgId: org.id, vendorUserId });
    // No record published → miss.
    const result = await checkDomainVerification({ vendorOrgId: org.id, vendorUserId });
    expect(result.verified).toBe(false);

    const [updated] = await db
      .select()
      .from(vendorOrgsTable)
      .where(eq(vendorOrgsTable.id, org.id));
    expect(updated?.status).toBe("pending");
    expect(updated?.domainVerifiedAt).toBeNull();

    const [verification] = await db
      .select()
      .from(vendorDomainVerificationsTable)
      .where(eq(vendorDomainVerificationsTable.vendorOrgId, org.id));
    expect(verification?.attempts).toBe(1);
    expect(verification?.lastCheckedAt).toBeInstanceOf(Date);
    expect(verification?.status).toBe("pending");
  });

  it("ignores a TXT record with the wrong token", async () => {
    const { org, vendorUserId } = await seedVendor();
    const started = await startDomainVerification({ vendorOrgId: org.id, vendorUserId });
    fakeDns.set(started.host, [expectedTxtValue("a".repeat(64))]); // wrong token
    const result = await checkDomainVerification({ vendorOrgId: org.id, vendorUserId });
    expect(result.verified).toBe(false);
  });

  it("a suspended org does not become active even with a valid record", async () => {
    const { org, vendorUserId } = await seedVendor();
    const started = await startDomainVerification({ vendorOrgId: org.id, vendorUserId });
    await db
      .update(vendorOrgsTable)
      .set({ status: "suspended" })
      .where(eq(vendorOrgsTable.id, org.id));
    fakeDns.set(started.host, [started.expectedValue]);

    const result = await checkDomainVerification({ vendorOrgId: org.id, vendorUserId });
    // The verification row is marked verified, but the org stays suspended.
    expect(result.verified).toBe(true);
    const [updated] = await db
      .select()
      .from(vendorOrgsTable)
      .where(eq(vendorOrgsTable.id, org.id));
    expect(updated?.status).toBe("suspended");
  });
});

describe("manuallyVerifyDomain", () => {
  it("verifies without DNS and records method=manual + note", async () => {
    const { org } = await seedVendor();
    const updated = await manuallyVerifyDomain({
      vendorOrgId: org.id,
      note: "Confirmed via signed partnership agreement.",
    });
    expect(updated.status).toBe("active");
    expect(updated.domainVerifiedAt).toBeInstanceOf(Date);

    const [verification] = await db
      .select()
      .from(vendorDomainVerificationsTable)
      .where(eq(vendorDomainVerificationsTable.vendorOrgId, org.id));
    expect(verification?.method).toBe("manual");
    expect(verification?.status).toBe("verified");
    expect(verification?.verifierNote).toContain("partnership");

    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, org.id));
    expect(audit.map((a) => a.action)).toContain(
      VENDOR_AUDIT_ACTIONS.vendorDomainVerifiedManually
    );
  });

  it("refuses to verify an archived org", async () => {
    const { org } = await seedVendor();
    await db
      .update(vendorOrgsTable)
      .set({ status: "archived" })
      .where(eq(vendorOrgsTable.id, org.id));
    await expect(
      manuallyVerifyDomain({ vendorOrgId: org.id, note: "x" })
    ).rejects.toThrow();
  });
});

describe("DNS resolver helpers", () => {
  it("builds the host + expected value consistently", () => {
    expect(verificationHost("acme.com")).toBe("_renewalradar.acme.com");
    expect(expectedTxtValue("tok")).toBe("renewalradar-verify=tok");
  });
});
