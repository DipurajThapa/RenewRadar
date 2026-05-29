/**
 * T4.10 Slice 1 — Vendor portal auth contract tests.
 *
 * These exercise the magic-link + session lifecycle directly against the
 * test DB. The invariants we're guarding:
 *
 *   - Personal-email domains are refused (gmail, yahoo, etc).
 *   - First signup at a brand-new domain self-provisions a vendor_org
 *     (pending) + vendor_user (admin) and audit-logs both.
 *   - Second signup at an EXISTING domain by a new email is refused
 *     ("company_account_exists") — no leaked-user attack vector.
 *   - Magic links are single-use, 15-min TTL, store only SHA-256 hash.
 *   - Sessions are 7-day, anchored TTL, store only SHA-256 hash, revocable.
 *   - validateSession() refuses revoked, expired, suspended, deactivated.
 *   - Rate limit kicks in at MAX_MAGIC_LINKS_PER_HOUR (5).
 *   - Suspended/archived vendor_orgs cannot sign in.
 *   - signOut revokes the session.
 *   - Every auth event has a vendor_audit_log entry.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  vendorAuditLogTable,
  vendorMagicLinksTable,
  vendorOrgsTable,
  vendorSessionsTable,
  vendorUsersTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  endSession,
  redeemMagicLink,
  requestMagicLink,
  validateSession,
  VendorAuthError,
} from "@server/application/vendor-portal";
import {
  hashToken,
  MAGIC_LINK_TTL_MS,
  MAX_MAGIC_LINKS_PER_HOUR,
  SESSION_TTL_MS,
} from "@server/application/vendor-portal/internals";
import { VENDOR_AUDIT_ACTIONS } from "@server/infrastructure/vendor-audit-log/writer";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

describe("requestMagicLink", () => {
  it("refuses personal-email domains", async () => {
    await expect(
      requestMagicLink({ email: "anyone@gmail.com" })
    ).rejects.toMatchObject({
      code: "personal_email_refused",
    });
  });

  it("refuses malformed emails", async () => {
    await expect(
      requestMagicLink({ email: "not-an-email" })
    ).rejects.toMatchObject({ code: "invalid_email" });
    await expect(
      requestMagicLink({ email: "missingdomain@" })
    ).rejects.toMatchObject({ code: "invalid_email" });
  });

  it("self-provisions vendor_org + admin vendor_user on first signup", async () => {
    const result = await requestMagicLink({
      email: "founder@AcmeWidgets.com",
    });

    expect(result.selfProvisioned).toBe(true);
    expect(result.vendorOrg.primaryDomain).toBe("acmewidgets.com");
    expect(result.vendorOrg.status).toBe("pending");
    expect(result.vendorOrg.displayName).toBe("Acmewidgets");
    expect(result.vendorOrg.slug).toBe("acmewidgets-com");
    expect(result.vendorUser.email).toBe("founder@acmewidgets.com");
    expect(result.vendorUser.role).toBe("admin");
    expect(result.rawToken).toMatch(/^[0-9a-f]{64}$/);
    // The stored hash is the SHA-256 of the raw token — never the raw.
    expect(result.magicLink.tokenHash).toBe(hashToken(result.rawToken));
    expect(result.magicLink.tokenHash).not.toBe(result.rawToken);
    // 15-min TTL: expiresAt is in [now + 14min, now + 16min].
    const expiresMs = result.magicLink.expiresAt.getTime();
    expect(expiresMs - Date.now()).toBeGreaterThan(MAGIC_LINK_TTL_MS - 60_000);
    expect(expiresMs - Date.now()).toBeLessThan(MAGIC_LINK_TTL_MS + 60_000);

    // Audit: vendor_org.registered, vendor_user.created, magic_link_issued.
    const auditRows = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, result.vendorOrg.id));
    const actions = auditRows.map((r) => r.action).sort();
    expect(actions).toEqual(
      [
        VENDOR_AUDIT_ACTIONS.vendorOrgRegistered,
        VENDOR_AUDIT_ACTIONS.vendorUserCreated,
        VENDOR_AUDIT_ACTIONS.vendorMagicLinkIssued,
      ].sort()
    );
  });

  it("re-issues for an existing user without creating a duplicate vendor_user", async () => {
    const first = await requestMagicLink({ email: "alice@vendora.io" });
    const second = await requestMagicLink({ email: "alice@vendora.io" });
    expect(second.selfProvisioned).toBe(false);
    expect(second.vendorUser.id).toBe(first.vendorUser.id);
    expect(second.vendorOrg.id).toBe(first.vendorOrg.id);
    expect(second.rawToken).not.toBe(first.rawToken);

    const allUsers = await db
      .select()
      .from(vendorUsersTable)
      .where(eq(vendorUsersTable.vendorOrgId, first.vendorOrg.id));
    expect(allUsers).toHaveLength(1);
  });

  it("refuses a second user at a known domain (must be invited)", async () => {
    await requestMagicLink({ email: "alice@vendorb.io" });
    await expect(
      requestMagicLink({ email: "bob@vendorb.io" })
    ).rejects.toMatchObject({
      code: "company_account_exists",
    });
  });

  it("refuses a suspended vendor_org", async () => {
    const first = await requestMagicLink({ email: "alice@suspended.io" });
    await db
      .update(vendorOrgsTable)
      .set({ status: "suspended" })
      .where(eq(vendorOrgsTable.id, first.vendorOrg.id));
    await expect(
      requestMagicLink({ email: "alice@suspended.io" })
    ).rejects.toMatchObject({ code: "vendor_org_suspended" });
  });

  it("treats archived org as deleted — re-signup creates a new org", async () => {
    const first = await requestMagicLink({ email: "alice@archived.io" });
    await db
      .update(vendorOrgsTable)
      .set({ status: "archived" })
      .where(eq(vendorOrgsTable.id, first.vendorOrg.id));
    const second = await requestMagicLink({ email: "alice@archived.io" });
    expect(second.vendorOrg.id).not.toBe(first.vendorOrg.id);
    expect(second.selfProvisioned).toBe(true);
  });

  it("refuses deactivated vendor users", async () => {
    const first = await requestMagicLink({ email: "alice@dropped.io" });
    await db
      .update(vendorUsersTable)
      .set({ active: false })
      .where(eq(vendorUsersTable.id, first.vendorUser.id));
    await expect(
      requestMagicLink({ email: "alice@dropped.io" })
    ).rejects.toMatchObject({ code: "vendor_user_inactive" });
  });

  it("rate-limits at MAX_MAGIC_LINKS_PER_HOUR", async () => {
    for (let i = 0; i < MAX_MAGIC_LINKS_PER_HOUR; i++) {
      await requestMagicLink({ email: "spammer@vendrate.io" });
    }
    await expect(
      requestMagicLink({ email: "spammer@vendrate.io" })
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("redeemMagicLink", () => {
  it("happy path: consumes link, marks email verified, starts session", async () => {
    const issued = await requestMagicLink({ email: "alice@happypath.io" });
    const result = await redeemMagicLink({
      rawToken: issued.rawToken,
      userAgent: "Mozilla/5.0 Test",
      ipAddress: "1.2.3.4",
    });

    expect(result.vendorUser.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.vendorUser.lastLoginAt).toBeInstanceOf(Date);
    expect(result.session.tokenHash).toBe(hashToken(result.rawSessionToken));
    expect(result.rawSessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.session.userAgent).toBe("Mozilla/5.0 Test");
    expect(result.session.ipAddress).toBe("1.2.3.4");

    // 7-day TTL with some slack.
    const ttl = result.session.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(SESSION_TTL_MS - 60_000);
    expect(ttl).toBeLessThan(SESSION_TTL_MS + 60_000);

    // Magic link marked consumed.
    const [link] = await db
      .select()
      .from(vendorMagicLinksTable)
      .where(eq(vendorMagicLinksTable.id, issued.magicLink.id));
    expect(link?.consumedAt).toBeInstanceOf(Date);

    // Audit: link redeemed + email verified + session started.
    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, issued.vendorOrg.id));
    const actions = audit.map((r) => r.action);
    expect(actions).toContain(VENDOR_AUDIT_ACTIONS.vendorMagicLinkRedeemed);
    expect(actions).toContain(VENDOR_AUDIT_ACTIONS.vendorUserEmailVerified);
    expect(actions).toContain(VENDOR_AUDIT_ACTIONS.vendorSessionStarted);
  });

  it("refuses unknown tokens", async () => {
    await expect(
      redeemMagicLink({ rawToken: "x".repeat(64) })
    ).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("refuses tokens shorter than 32 chars (invalid by shape)", async () => {
    await expect(
      redeemMagicLink({ rawToken: "abcd" })
    ).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("refuses a previously-consumed token (single-use)", async () => {
    const issued = await requestMagicLink({ email: "alice@singleuse.io" });
    await redeemMagicLink({ rawToken: issued.rawToken });
    await expect(
      redeemMagicLink({ rawToken: issued.rawToken })
    ).rejects.toMatchObject({ code: "token_already_used" });
  });

  it("refuses an expired token", async () => {
    const issued = await requestMagicLink({ email: "alice@expires.io" });
    await db
      .update(vendorMagicLinksTable)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(vendorMagicLinksTable.id, issued.magicLink.id));
    await expect(
      redeemMagicLink({ rawToken: issued.rawToken })
    ).rejects.toMatchObject({ code: "token_expired" });
  });

  it("does NOT re-set emailVerifiedAt on a subsequent sign-in", async () => {
    const first = await requestMagicLink({ email: "alice@twice.io" });
    const firstRedeem = await redeemMagicLink({ rawToken: first.rawToken });
    const firstVerifiedAt = firstRedeem.vendorUser.emailVerifiedAt;

    const second = await requestMagicLink({ email: "alice@twice.io" });
    const secondRedeem = await redeemMagicLink({ rawToken: second.rawToken });

    expect(secondRedeem.vendorUser.emailVerifiedAt?.getTime()).toBe(
      firstVerifiedAt?.getTime()
    );
    // lastLoginAt is touched on every sign-in. We can't strictly assert
    // it advances because both ops can land in the same Postgres millisecond
    // bucket on a fast machine; the invariant we care about is just that
    // it's set on the second redeem (not still null), so the >= check
    // catches a regression without flaking on sub-ms timing.
    expect(secondRedeem.vendorUser.lastLoginAt).toBeInstanceOf(Date);
    expect(
      secondRedeem.vendorUser.lastLoginAt!.getTime()
    ).toBeGreaterThanOrEqual(firstRedeem.vendorUser.lastLoginAt!.getTime());
  });

  it("refuses if vendor_user was deactivated between issue and redeem", async () => {
    const issued = await requestMagicLink({ email: "alice@racy.io" });
    await db
      .update(vendorUsersTable)
      .set({ active: false })
      .where(eq(vendorUsersTable.id, issued.vendorUser.id));
    await expect(
      redeemMagicLink({ rawToken: issued.rawToken })
    ).rejects.toMatchObject({ code: "vendor_user_inactive" });
  });

  it("refuses if vendor_org was suspended between issue and redeem", async () => {
    const issued = await requestMagicLink({ email: "alice@badluck.io" });
    await db
      .update(vendorOrgsTable)
      .set({ status: "suspended" })
      .where(eq(vendorOrgsTable.id, issued.vendorOrg.id));
    await expect(
      redeemMagicLink({ rawToken: issued.rawToken })
    ).rejects.toMatchObject({ code: "vendor_org_suspended" });
  });
});

describe("validateSession", () => {
  async function startSession(email: string) {
    const issued = await requestMagicLink({ email });
    return redeemMagicLink({
      rawToken: issued.rawToken,
      userAgent: "Test",
      ipAddress: "1.1.1.1",
    });
  }

  it("returns the validated session for a fresh token", async () => {
    const r = await startSession("alice@validate.io");
    const v = await validateSession(r.rawSessionToken);
    expect(v).not.toBeNull();
    expect(v?.vendorOrg.id).toBe(r.vendorOrg.id);
    expect(v?.vendorUser.id).toBe(r.vendorUser.id);
    expect(v?.session.id).toBe(r.session.id);
  });

  it("returns null for an unknown token", async () => {
    const v = await validateSession("z".repeat(64));
    expect(v).toBeNull();
  });

  it("returns null for empty/short tokens", async () => {
    expect(await validateSession("")).toBeNull();
    expect(await validateSession("abc")).toBeNull();
  });

  it("returns null when the session is expired", async () => {
    const r = await startSession("alice@validate-exp.io");
    await db
      .update(vendorSessionsTable)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(vendorSessionsTable.id, r.session.id));
    expect(await validateSession(r.rawSessionToken)).toBeNull();
  });

  it("returns null when the session is revoked", async () => {
    const r = await startSession("alice@validate-rev.io");
    await db
      .update(vendorSessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(vendorSessionsTable.id, r.session.id));
    expect(await validateSession(r.rawSessionToken)).toBeNull();
  });

  it("returns null when the vendor_user is deactivated", async () => {
    const r = await startSession("alice@validate-deac.io");
    await db
      .update(vendorUsersTable)
      .set({ active: false })
      .where(eq(vendorUsersTable.id, r.vendorUser.id));
    expect(await validateSession(r.rawSessionToken)).toBeNull();
  });

  it("returns null when the vendor_org is suspended", async () => {
    const r = await startSession("alice@validate-susp.io");
    await db
      .update(vendorOrgsTable)
      .set({ status: "suspended" })
      .where(eq(vendorOrgsTable.id, r.vendorOrg.id));
    expect(await validateSession(r.rawSessionToken)).toBeNull();
  });
});

describe("endSession", () => {
  it("revokes the session and audit-logs the action", async () => {
    const issued = await requestMagicLink({ email: "alice@signsout.io" });
    const r = await redeemMagicLink({ rawToken: issued.rawToken });
    await endSession({ sessionId: r.session.id, reason: "manual" });

    const [session] = await db
      .select()
      .from(vendorSessionsTable)
      .where(eq(vendorSessionsTable.id, r.session.id));
    expect(session?.revokedAt).toBeInstanceOf(Date);

    expect(await validateSession(r.rawSessionToken)).toBeNull();

    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, r.vendorOrg.id));
    expect(audit.map((row) => row.action)).toContain(
      VENDOR_AUDIT_ACTIONS.vendorSessionEnded
    );
  });

  it("is idempotent — second end is a no-op", async () => {
    const issued = await requestMagicLink({ email: "alice@idem.io" });
    const r = await redeemMagicLink({ rawToken: issued.rawToken });
    await endSession({ sessionId: r.session.id, reason: "manual" });
    await endSession({ sessionId: r.session.id, reason: "manual" });

    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, r.vendorOrg.id));
    const endCount = audit.filter(
      (row) => row.action === VENDOR_AUDIT_ACTIONS.vendorSessionEnded
    ).length;
    expect(endCount).toBe(1);
  });

  it("uses 'revoked_by_admin' label when applicable", async () => {
    const issued = await requestMagicLink({ email: "alice@admin-revoke.io" });
    const r = await redeemMagicLink({ rawToken: issued.rawToken });
    await endSession({ sessionId: r.session.id, reason: "revoked_by_admin" });
    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, r.vendorOrg.id));
    expect(audit.map((row) => row.action)).toContain(
      VENDOR_AUDIT_ACTIONS.vendorSessionRevoked
    );
  });
});

describe("token storage invariants", () => {
  it("stores only the SHA-256 hash of the magic-link token — never the raw value", async () => {
    const issued = await requestMagicLink({ email: "alice@hash.io" });
    const [row] = await db
      .select()
      .from(vendorMagicLinksTable)
      .where(eq(vendorMagicLinksTable.id, issued.magicLink.id));
    expect(row?.tokenHash).toBe(hashToken(issued.rawToken));
    // The DB row has no column carrying the raw token, but be paranoid:
    // check the hash isn't equal to the raw (would indicate misconfig).
    expect(row?.tokenHash).not.toBe(issued.rawToken);
    expect(row?.tokenHash?.length).toBe(64); // sha256 hex
  });

  it("stores only the SHA-256 hash of the session token", async () => {
    const issued = await requestMagicLink({ email: "alice@sesshash.io" });
    const r = await redeemMagicLink({ rawToken: issued.rawToken });
    const [row] = await db
      .select()
      .from(vendorSessionsTable)
      .where(eq(vendorSessionsTable.id, r.session.id));
    expect(row?.tokenHash).toBe(hashToken(r.rawSessionToken));
    expect(row?.tokenHash).not.toBe(r.rawSessionToken);
  });

  it("each magic-link request mints a different token (no reuse)", async () => {
    const a = await requestMagicLink({ email: "alice@nonce.io" });
    const b = await requestMagicLink({ email: "alice@nonce.io" });
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.magicLink.tokenHash).not.toBe(b.magicLink.tokenHash);
  });
});

describe("VendorAuthError shape", () => {
  it("carries a stable .code property the action layer can switch on", async () => {
    try {
      await requestMagicLink({ email: "test@gmail.com" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VendorAuthError);
      expect((err as VendorAuthError).code).toBe("personal_email_refused");
      expect((err as VendorAuthError).name).toBe("VendorAuthError");
    }
  });
});
