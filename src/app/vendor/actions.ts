"use server";

/**
 * T4.10 — Vendor portal server actions.
 *
 * These run on the SAME Next.js process as the customer app but are
 * completely outside Clerk. Auth state is the `__rr_vendor_session`
 * cookie; the resolver lives in `@server/middleware/current-vendor`.
 *
 * RBAC coverage: this file is in the exempt list at
 * `src/server/middleware/__tests__/rbac-coverage.test.ts` because the
 * "role" model here is `requireCurrentVendor` + the application-layer
 * checks on the vendor_user/vendor_org status. Audit coverage is in the
 * same boat — vendor mutations write to `vendor_audit_log` via
 * `writeVendorAuditLog` (the application module does this).
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  endSession,
  redeemMagicLink,
  requestMagicLink,
  VendorAuthError,
} from "@server/application/vendor-portal";
import { getCurrentVendor, VENDOR_COOKIE_BASE_OPTIONS } from "@server/middleware/current-vendor";
import {
  getRateLimit,
  VENDOR_MAGIC_LINK_POLICY,
} from "@server/infrastructure/rate-limit";
import { sendEmail } from "@server/infrastructure/email/client";
import { createLogger } from "@server/infrastructure/observability/logger";
import {
  SESSION_TTL_MS,
} from "@server/application/vendor-portal/internals";

const log = createLogger({ component: "vendor-actions" });

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Best-effort client-IP lookup. We honor X-Forwarded-For when set (we run
 * behind Vercel / a proxy) but fall back to "0.0.0.0" so the rate-limit
 * bucket has *some* key when the header is absent (dev). It is not used
 * for security decisions — just rate-limit bucketing and forensic info.
 */
async function getRequestIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? "0.0.0.0";
}

async function getRequestUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}

/**
 * Process the sign-in form. Always returns the same "Check your email"
 * UX regardless of whether the email mapped to an existing user, so we
 * don't leak account existence — EXCEPT for the categorical refuse cases
 * (personal email, suspended org, second-user-at-known-org), which carry
 * actionable info the user needs.
 */
export async function submitSignInFormAction(formData: FormData): Promise<void> {
  const rawEmail = (formData.get("email") as string | null)?.trim() ?? "";

  // 1. IP-bucket rate-limit first — refusing here means we don't even
  //    do a DB lookup for an attacker hammering the endpoint.
  const ip = await getRequestIp();
  const rl = await getRateLimit().check(
    `vendor-magic-link:${ip}`,
    VENDOR_MAGIC_LINK_POLICY
  );
  if (!rl.allowed) {
    redirect(
      `/vendor/sign-in?error=${encodeURIComponent(
        "Too many sign-in attempts. Try again in a few minutes."
      )}`
    );
  }

  // 2. Issue magic link via the application module.
  let result;
  try {
    result = await requestMagicLink({ email: rawEmail, requestedFromIp: ip });
  } catch (err) {
    if (err instanceof VendorAuthError) {
      // Categorical errors we DO surface so the user understands why.
      const userFacingCodes: VendorAuthError["code"][] = [
        "invalid_email",
        "personal_email_refused",
        "vendor_org_suspended",
        "vendor_user_inactive",
        "company_account_exists",
        "rate_limited",
      ];
      if (userFacingCodes.includes(err.code)) {
        redirect(`/vendor/sign-in?error=${encodeURIComponent(err.message)}`);
      }
      // Anything else: same generic flow as success — don't leak existence.
      log.warn("vendor magic-link soft refuse", { code: err.code });
      redirect(`/vendor/check-email?email=${encodeURIComponent(rawEmail)}`);
    }
    throw err;
  }

  // 3. Email the link. Don't await delivery on the request path; the
  //    application module already audit-logged the issuance. If email
  //    fails the user can click "resend".
  const link = `${APP_URL}/vendor/auth/callback?token=${encodeURIComponent(
    result.rawToken
  )}`;
  void sendEmail({
    to: result.vendorUser.email,
    subject: "Sign in to Renewal Radar — vendor portal",
    html: renderMagicLinkHtml({
      displayName: result.vendorOrg.displayName,
      link,
      selfProvisioned: result.selfProvisioned,
    }),
    text: renderMagicLinkText({
      displayName: result.vendorOrg.displayName,
      link,
      selfProvisioned: result.selfProvisioned,
    }),
  }).catch((err) => {
    log.error("vendor magic-link email send failed", {
      vendorUserId: result.vendorUser.id,
      err: err instanceof Error ? err.message : String(err),
    });
  });

  redirect(`/vendor/check-email?email=${encodeURIComponent(result.vendorUser.email)}`);
}

/**
 * Handle the magic-link click. Reads `token` from the URL, redeems it,
 * sets the session cookie, redirects to the dashboard.
 *
 * Returning `void` + `redirect` mirrors the framework idiom — the page
 * itself just invokes this on render via a Server Component (see
 * `/vendor/auth/callback/page.tsx`).
 */
export async function redeemMagicLinkAction(rawToken: string): Promise<void> {
  const ua = await getRequestUserAgent();
  const ip = await getRequestIp();

  let result;
  try {
    result = await redeemMagicLink({
      rawToken,
      userAgent: ua,
      ipAddress: ip,
    });
  } catch (err) {
    if (err instanceof VendorAuthError) {
      redirect(
        `/vendor/sign-in?error=${encodeURIComponent(err.message)}`
      );
    }
    throw err;
  }

  // Set the HttpOnly session cookie.
  const cookieStore = await cookies();
  cookieStore.set({
    ...VENDOR_COOKIE_BASE_OPTIONS,
    value: result.rawSessionToken,
    expires: new Date(Date.now() + SESSION_TTL_MS),
  });

  redirect("/vendor/dashboard");
}

/** Sign-out: revoke the current session + clear the cookie. */
export async function signOutAction(): Promise<void> {
  const current = await getCurrentVendor();
  if (current) {
    await endSession({ sessionId: current.session.id, reason: "manual" });
  }
  const cookieStore = await cookies();
  cookieStore.set({
    ...VENDOR_COOKIE_BASE_OPTIONS,
    value: "",
    expires: new Date(0),
  });
  redirect("/vendor/sign-in");
}

// ─── Email templates ──────────────────────────────────────────────────

function renderMagicLinkHtml(input: {
  displayName: string;
  link: string;
  selfProvisioned: boolean;
}): string {
  const headline = input.selfProvisioned
    ? `Welcome to Renewal Radar's vendor portal, ${escapeHtml(
        input.displayName
      )}.`
    : `Sign in to ${escapeHtml(input.displayName)} on Renewal Radar.`;
  return `
<!doctype html>
<html><body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #0f172a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 18px; margin: 0 0 16px;">${headline}</h1>
  <p style="margin: 0 0 16px;">
    Click the button below to sign in. This link works once and expires in 15 minutes.
  </p>
  <p style="margin: 0 0 24px;">
    <a href="${input.link}" style="display: inline-block; background: #0f766e; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600;">Sign in</a>
  </p>
  <p style="margin: 0 0 8px; font-size: 13px; color: #475569;">
    Or copy and paste this URL:<br/>
    <code style="background:#f1f5f9; padding:2px 4px; border-radius:4px; word-break:break-all;">${input.link}</code>
  </p>
  <p style="margin: 24px 0 0; font-size: 12px; color: #64748b;">
    If you didn't request this, you can ignore this email. Renewal Radar never
    emails your customers without their consent.
  </p>
</body></html>`;
}

function renderMagicLinkText(input: {
  displayName: string;
  link: string;
  selfProvisioned: boolean;
}): string {
  const headline = input.selfProvisioned
    ? `Welcome to Renewal Radar's vendor portal, ${input.displayName}.`
    : `Sign in to ${input.displayName} on Renewal Radar.`;
  return [
    headline,
    "",
    "Click the link below to sign in. This link works once and expires in 15 minutes.",
    "",
    input.link,
    "",
    "If you didn't request this, you can ignore this email. Renewal Radar never emails your customers without their consent.",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
