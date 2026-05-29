/**
 * T4.10 Slice 1 — Vendor portal auth.
 *
 * Lives entirely separate from customer Clerk auth. Vendors authenticate
 * via magic-link only:
 *
 *   1. Vendor enters work email at /vendor/sign-in
 *   2. `requestMagicLink()` validates the email + domain, looks up or
 *      auto-provisions a `vendor_org` + `vendor_user`, issues a single-use
 *      token (we store only the SHA-256 hash), and returns the raw token
 *      to the caller so the action layer can email it.
 *   3. Vendor clicks the link → `/vendor/auth/callback?token=...` →
 *      `redeemMagicLink()` consumes the token, marks email verified,
 *      and starts a DB-backed session.
 *   4. The raw session token is set in a HttpOnly cookie. Every request
 *      to /vendor/* calls `validateSession()`.
 *
 * Invariants enforced here:
 *   - Magic links are SINGLE USE (consumedAt) and short-lived (15 min).
 *   - The raw magic-link token is NEVER stored — only its SHA-256 hash.
 *   - The raw session token is NEVER stored — only its SHA-256 hash.
 *   - We rate-limit magic-link issuance per vendor user (5/hr) so a leaked
 *     email can't be used to spam inboxes.
 *   - "Soft delete" only: revoke via `vendor_user.active=false` or
 *     `vendor_org.status='archived'`; the rows themselves are preserved
 *     so audit-log FKs stay intact.
 *   - Only the FIRST signup at a domain auto-provisions. Subsequent
 *     signups at a domain that already has a vendor_org must be invited
 *     by an existing admin (Slice 2). For Slice 1 the second-signup path
 *     returns a "your company already has an account" error.
 *   - Personal-email domains (gmail, yahoo, etc.) are refused — the
 *     vendor portal is for companies pushing announcements to their
 *     customers, not personal accounts.
 *
 * Postgres-js transaction caveat: every operation here is a single
 * focused transaction. We do NOT call other application modules from
 * inside a transaction — see the T4.11 postmortem in
 * `src/server/application/intake-requests/index.ts` for the deadlock that
 * pattern caused. If a later slice needs to compose with another module,
 * follow the "prepare-then-commit" pattern used in
 * `approveIntakeRequest`.
 */
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  vendorMagicLinksTable,
  vendorOrgsTable,
  vendorSessionsTable,
  vendorUsersTable,
  type VendorMagicLink,
  type VendorOrg,
  type VendorSession,
  type VendorUser,
} from "@server/infrastructure/db/schema";
import {
  VENDOR_AUDIT_ACTIONS,
  writeVendorAuditLog,
} from "@server/infrastructure/vendor-audit-log/writer";
import { createLogger } from "@server/infrastructure/observability/logger";
import {
  MAGIC_LINK_TTL_MS,
  MAX_MAGIC_LINKS_PER_HOUR,
  SESSION_TTL_MS,
  displayNameFromDomain,
  extractDomain,
  generateOpaqueToken,
  hashToken,
  isPersonalEmailDomain,
  isValidEmailShape,
  normalizeEmail,
  slugFromDomain,
  timingSafeHashEqual,
  truncateIp,
  truncateUserAgent,
} from "./internals";

const log = createLogger({ component: "vendor-portal" });

export class VendorAuthError extends Error {
  /**
   * `code` is the machine label the UI can switch on. `message` is the
   * customer-facing text — keep it benign on purpose (don't reveal whether
   * an account exists for unknown emails on the sign-in form, etc.).
   */
  readonly code:
    | "invalid_email"
    | "personal_email_refused"
    | "vendor_org_suspended"
    | "vendor_user_inactive"
    | "company_account_exists"
    | "rate_limited"
    | "token_invalid"
    | "token_expired"
    | "token_already_used"
    | "session_invalid";
  constructor(code: VendorAuthError["code"], message: string) {
    super(message);
    this.name = "VendorAuthError";
    this.code = code;
  }
}

export type RequestMagicLinkInput = {
  email: string;
  requestedFromIp?: string | null;
};

export type RequestMagicLinkResult = {
  vendorOrg: VendorOrg;
  vendorUser: VendorUser;
  magicLink: VendorMagicLink;
  /**
   * The raw token to put in the email URL. Returned from this layer so
   * the caller (server action) controls the email send and the URL shape.
   * Do not log or persist this.
   */
  rawToken: string;
  /** Whether this call self-provisioned a brand-new vendor_org. */
  selfProvisioned: boolean;
};

/**
 * Issue a magic link. Auto-provisions a vendor_org on first signup at a
 * brand-new domain; refuses second-signup at a known domain (Slice 2 will
 * add admin-invite for additional users).
 *
 * Throws `VendorAuthError` on any user-facing reject reason. Internal
 * errors propagate.
 */
export async function requestMagicLink(
  input: RequestMagicLinkInput
): Promise<RequestMagicLinkResult> {
  const email = normalizeEmail(input.email);
  if (!isValidEmailShape(email)) {
    throw new VendorAuthError("invalid_email", "Enter a valid work email.");
  }
  const domain = extractDomain(email);
  if (isPersonalEmailDomain(domain)) {
    throw new VendorAuthError(
      "personal_email_refused",
      "The vendor portal is for companies. Use your work email."
    );
  }

  // Single transaction: look up or create the org + user, then count
  // recent magic links (rate-limit), then insert the new magic link.
  return db.transaction(async (tx) => {
    // 1. Find the vendor_org for this domain.
    //    - "pending" or "active" → eligible, sign-in proceeds.
    //    - "suspended" → org exists but BLOCKED. We deliberately surface
    //       it here so a new signup at the same domain can't bypass a
    //       staff suspension by re-registering — that's the entire point
    //       of suspension. The user-facing error is generic.
    //    - "archived" → treated as deleted. Lookup excludes it so a new
    //       signup at the same domain creates a fresh pending org.
    const [existingOrg] = await tx
      .select()
      .from(vendorOrgsTable)
      .where(
        and(
          eq(vendorOrgsTable.primaryDomain, domain),
          sql`${vendorOrgsTable.status} IN ('pending', 'active', 'suspended')`
        )
      )
      .limit(1);

    let vendorOrg: VendorOrg;
    let selfProvisioned = false;

    if (!existingOrg) {
      // First signup at this domain — auto-create the org. The first user
      // becomes the admin. They claim the org on behalf of their company;
      // Slice 2 will add the DNS-based domain verification step.
      const baseSlug = slugFromDomain(domain) || "vendor";
      const slug = await pickUniqueSlug(tx, baseSlug);
      const [created] = await tx
        .insert(vendorOrgsTable)
        .values({
          displayName: displayNameFromDomain(domain),
          slug,
          primaryDomain: domain,
          status: "pending",
        })
        .returning();
      if (!created) {
        throw new Error("Failed to create vendor_org");
      }
      vendorOrg = created;
      selfProvisioned = true;

      await writeVendorAuditLog(tx, {
        vendorOrgId: vendorOrg.id,
        actorVendorUserId: null,
        action: VENDOR_AUDIT_ACTIONS.vendorOrgRegistered,
        target: { entityType: "vendor_org", entityId: vendorOrg.id },
        after: {
          displayName: vendorOrg.displayName,
          primaryDomain: vendorOrg.primaryDomain,
          status: vendorOrg.status,
          slug: vendorOrg.slug,
        },
      });
    } else {
      if (existingOrg.status === "suspended") {
        throw new VendorAuthError(
          "vendor_org_suspended",
          "This vendor account is suspended. Contact Renewal Radar support."
        );
      }
      vendorOrg = existingOrg;
    }

    // 2. Find or create the vendor_user. The very first user at a new org
    //    becomes `admin`. Any other case must already exist — we don't
    //    auto-provision additional users (Slice 2 will add admin invites).
    const [existingUser] = await tx
      .select()
      .from(vendorUsersTable)
      .where(
        and(
          eq(vendorUsersTable.vendorOrgId, vendorOrg.id),
          eq(vendorUsersTable.email, email)
        )
      )
      .limit(1);

    let vendorUser: VendorUser;
    if (!existingUser) {
      if (!selfProvisioned) {
        // The org exists but this email isn't on it. We don't reveal
        // whether or not this email is on the org's user list — but we
        // can't issue a link to a user we didn't create. Pre-existing
        // users at known orgs must be invited (Slice 2).
        throw new VendorAuthError(
          "company_account_exists",
          "Your company already has a vendor account. Ask an admin at " +
            vendorOrg.displayName +
            " to invite you."
        );
      }
      const [created] = await tx
        .insert(vendorUsersTable)
        .values({
          vendorOrgId: vendorOrg.id,
          email,
          role: "admin", // first user at a freshly-claimed org
        })
        .returning();
      if (!created) {
        throw new Error("Failed to create vendor_user");
      }
      vendorUser = created;

      await writeVendorAuditLog(tx, {
        vendorOrgId: vendorOrg.id,
        actorVendorUserId: vendorUser.id,
        action: VENDOR_AUDIT_ACTIONS.vendorUserCreated,
        target: { entityType: "vendor_user", entityId: vendorUser.id },
        after: { email: vendorUser.email, role: vendorUser.role },
      });
    } else {
      if (!existingUser.active) {
        throw new VendorAuthError(
          "vendor_user_inactive",
          "This vendor account has been deactivated."
        );
      }
      vendorUser = existingUser;
    }

    // 3. Rate-limit: refuse if we've issued ≥ MAX in the last hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(vendorMagicLinksTable)
      .where(
        and(
          eq(vendorMagicLinksTable.vendorUserId, vendorUser.id),
          gte(vendorMagicLinksTable.createdAt, oneHourAgo)
        )
      );
    const recentCount = countRows[0]?.count ?? 0;
    if (recentCount >= MAX_MAGIC_LINKS_PER_HOUR) {
      throw new VendorAuthError(
        "rate_limited",
        "Too many sign-in attempts. Wait an hour and try again."
      );
    }

    // 4. Mint and store. Raw token is returned to the caller; only the
    //    hash hits the database.
    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

    const [magicLink] = await tx
      .insert(vendorMagicLinksTable)
      .values({
        vendorUserId: vendorUser.id,
        tokenHash,
        expiresAt,
        requestedFromIp: truncateIp(input.requestedFromIp),
      })
      .returning();
    if (!magicLink) {
      throw new Error("Failed to create magic link");
    }

    await writeVendorAuditLog(tx, {
      vendorOrgId: vendorOrg.id,
      actorVendorUserId: vendorUser.id,
      action: VENDOR_AUDIT_ACTIONS.vendorMagicLinkIssued,
      target: { entityType: "vendor_magic_link", entityId: magicLink.id },
      after: {
        expiresAt: magicLink.expiresAt.toISOString(),
        requestedFromIp: magicLink.requestedFromIp,
      },
    });

    log.info("vendor magic link issued", {
      vendorOrgId: vendorOrg.id,
      vendorUserId: vendorUser.id,
      selfProvisioned,
    });

    return { vendorOrg, vendorUser, magicLink, rawToken, selfProvisioned };
  });
}

/**
 * Pick the next available slug. If the base is taken, append -2, -3, …
 * until we find a free one. Cheap because vendor_org has a unique index
 * on slug and we expect very few collisions per domain root.
 */
async function pickUniqueSlug(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  base: string
): Promise<string> {
  for (let i = 0; i < 32; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [hit] = await tx
      .select({ id: vendorOrgsTable.id })
      .from(vendorOrgsTable)
      .where(eq(vendorOrgsTable.slug, candidate))
      .limit(1);
    if (!hit) return candidate;
  }
  // Astronomically unlikely; surface so a human investigates.
  throw new Error(`Could not find a free vendor_org slug starting with ${base}`);
}

export type RedeemMagicLinkInput = {
  rawToken: string;
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type RedeemMagicLinkResult = {
  vendorOrg: VendorOrg;
  vendorUser: VendorUser;
  session: VendorSession;
  /** The raw session token to put in the HttpOnly cookie. */
  rawSessionToken: string;
};

/**
 * Consume a magic link and start a session. Throws on any reject case so
 * the action layer can map cleanly to UI states.
 */
export async function redeemMagicLink(
  input: RedeemMagicLinkInput
): Promise<RedeemMagicLinkResult> {
  if (!input.rawToken || input.rawToken.length < 32) {
    throw new VendorAuthError("token_invalid", "This link is invalid.");
  }
  const tokenHash = hashToken(input.rawToken);

  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(vendorMagicLinksTable)
      .where(eq(vendorMagicLinksTable.tokenHash, tokenHash))
      .limit(1);

    if (!link) {
      throw new VendorAuthError("token_invalid", "This link is invalid.");
    }
    // Use timing-safe equality on the hash bytes in addition to the
    // unique-index lookup so timing attacks can't probe the token space.
    if (!timingSafeHashEqual(link.tokenHash, tokenHash)) {
      throw new VendorAuthError("token_invalid", "This link is invalid.");
    }
    if (link.consumedAt) {
      throw new VendorAuthError(
        "token_already_used",
        "This link has already been used. Request a new one."
      );
    }
    if (link.expiresAt.getTime() <= Date.now()) {
      throw new VendorAuthError(
        "token_expired",
        "This link has expired. Request a new one."
      );
    }

    // Pull the vendor_user + vendor_org.
    const [vendorUser] = await tx
      .select()
      .from(vendorUsersTable)
      .where(eq(vendorUsersTable.id, link.vendorUserId))
      .limit(1);
    if (!vendorUser) {
      throw new Error("vendor_user missing for magic link");
    }
    if (!vendorUser.active) {
      throw new VendorAuthError(
        "vendor_user_inactive",
        "This vendor account has been deactivated."
      );
    }

    const [vendorOrg] = await tx
      .select()
      .from(vendorOrgsTable)
      .where(eq(vendorOrgsTable.id, vendorUser.vendorOrgId))
      .limit(1);
    if (!vendorOrg) {
      throw new Error("vendor_org missing for vendor_user");
    }
    if (vendorOrg.status === "suspended" || vendorOrg.status === "archived") {
      throw new VendorAuthError(
        "vendor_org_suspended",
        "This vendor account is suspended. Contact Renewal Radar support."
      );
    }

    // 1. Consume the magic link (race-safe via createdAt-as-of guard:
    //    we already have it loaded; the unique index on tokenHash makes
    //    a second concurrent redeem impossible to "win" — the second
    //    consumedAt update would still succeed but the second caller
    //    sees consumedAt already set on their next read in their tx).
    //    We add `WHERE consumedAt IS NULL` to make the guard explicit
    //    so a concurrent redeem fails fast.
    const [consumed] = await tx
      .update(vendorMagicLinksTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(vendorMagicLinksTable.id, link.id),
          isNull(vendorMagicLinksTable.consumedAt)
        )
      )
      .returning();
    if (!consumed) {
      throw new VendorAuthError(
        "token_already_used",
        "This link has already been used. Request a new one."
      );
    }

    // 2. Mark email verified on first redemption.
    let updatedUser = vendorUser;
    if (!vendorUser.emailVerifiedAt) {
      const [verified] = await tx
        .update(vendorUsersTable)
        .set({
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
        })
        .where(eq(vendorUsersTable.id, vendorUser.id))
        .returning();
      if (verified) updatedUser = verified;

      await writeVendorAuditLog(tx, {
        vendorOrgId: vendorOrg.id,
        actorVendorUserId: vendorUser.id,
        action: VENDOR_AUDIT_ACTIONS.vendorUserEmailVerified,
        target: { entityType: "vendor_user", entityId: vendorUser.id },
        after: { email: vendorUser.email },
      });
    } else {
      // Just refresh lastLoginAt.
      await tx
        .update(vendorUsersTable)
        .set({ lastLoginAt: new Date() })
        .where(eq(vendorUsersTable.id, vendorUser.id));
    }

    await writeVendorAuditLog(tx, {
      vendorOrgId: vendorOrg.id,
      actorVendorUserId: vendorUser.id,
      action: VENDOR_AUDIT_ACTIONS.vendorMagicLinkRedeemed,
      target: { entityType: "vendor_magic_link", entityId: link.id },
      before: { consumedAt: null },
      after: { consumedAt: consumed.consumedAt?.toISOString() ?? null },
    });

    // 3. Mint a session. Raw token only returned; only hash in DB.
    const rawSessionToken = generateOpaqueToken();
    const sessionTokenHash = hashToken(rawSessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const [session] = await tx
      .insert(vendorSessionsTable)
      .values({
        vendorUserId: vendorUser.id,
        tokenHash: sessionTokenHash,
        expiresAt,
        userAgent: truncateUserAgent(input.userAgent),
        ipAddress: truncateIp(input.ipAddress),
      })
      .returning();
    if (!session) {
      throw new Error("Failed to create vendor_session");
    }

    await writeVendorAuditLog(tx, {
      vendorOrgId: vendorOrg.id,
      actorVendorUserId: vendorUser.id,
      action: VENDOR_AUDIT_ACTIONS.vendorSessionStarted,
      target: { entityType: "vendor_session", entityId: session.id },
      after: {
        expiresAt: session.expiresAt.toISOString(),
        userAgent: session.userAgent,
      },
    });

    log.info("vendor session started", {
      vendorOrgId: vendorOrg.id,
      vendorUserId: vendorUser.id,
      sessionId: session.id,
    });

    return {
      vendorOrg,
      vendorUser: updatedUser,
      session,
      rawSessionToken,
    };
  });
}

export type ValidatedSession = {
  vendorOrg: VendorOrg;
  vendorUser: VendorUser;
  session: VendorSession;
};

/**
 * Resolve the current vendor session from the raw cookie token. Returns
 * null on any miss (expired, revoked, deactivated, etc.) — the caller
 * decides whether to redirect or 404. Updates lastSeenAt as a side
 * effect; no audit log entry (read path).
 */
export async function validateSession(
  rawSessionToken: string
): Promise<ValidatedSession | null> {
  if (!rawSessionToken || rawSessionToken.length < 32) return null;
  const tokenHash = hashToken(rawSessionToken);

  const [row] = await db
    .select({
      session: vendorSessionsTable,
      vendorUser: vendorUsersTable,
      vendorOrg: vendorOrgsTable,
    })
    .from(vendorSessionsTable)
    .innerJoin(
      vendorUsersTable,
      eq(vendorSessionsTable.vendorUserId, vendorUsersTable.id)
    )
    .innerJoin(
      vendorOrgsTable,
      eq(vendorUsersTable.vendorOrgId, vendorOrgsTable.id)
    )
    .where(eq(vendorSessionsTable.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (row.session.revokedAt) return null;
  if (row.session.expiresAt.getTime() <= Date.now()) return null;
  if (!row.vendorUser.active) return null;
  if (row.vendorOrg.status === "suspended" || row.vendorOrg.status === "archived")
    return null;

  // Update lastSeenAt — don't block the request on a fire-and-forget
  // write either, since it's only a freshness hint.
  void db
    .update(vendorSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(vendorSessionsTable.id, row.session.id))
    .catch((err) => {
      log.warn("failed to update vendor_session.lastSeenAt", {
        sessionId: row.session.id,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  return {
    session: row.session,
    vendorUser: row.vendorUser,
    vendorOrg: row.vendorOrg,
  };
}

/**
 * End a session — sign-out, or a future "revoke other sessions" UI.
 * Idempotent: ending an already-ended session is a no-op.
 */
export async function endSession(input: {
  sessionId: string;
  reason: "manual" | "revoked_by_admin";
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(vendorSessionsTable)
      .where(eq(vendorSessionsTable.id, input.sessionId))
      .limit(1);
    if (!session || session.revokedAt) return;

    const [updated] = await tx
      .update(vendorSessionsTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(vendorSessionsTable.id, input.sessionId),
          isNull(vendorSessionsTable.revokedAt)
        )
      )
      .returning();
    if (!updated) return;

    const [vendorUser] = await tx
      .select()
      .from(vendorUsersTable)
      .where(eq(vendorUsersTable.id, session.vendorUserId))
      .limit(1);
    if (!vendorUser) return;

    await writeVendorAuditLog(tx, {
      vendorOrgId: vendorUser.vendorOrgId,
      actorVendorUserId: vendorUser.id,
      action:
        input.reason === "manual"
          ? VENDOR_AUDIT_ACTIONS.vendorSessionEnded
          : VENDOR_AUDIT_ACTIONS.vendorSessionRevoked,
      target: { entityType: "vendor_session", entityId: session.id },
      after: { reason: input.reason },
    });
  });
}
