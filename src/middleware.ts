import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "@server/middleware/demo-mode";

const isPublicRoute = createRouteMatcher([
  "/",
  "/pricing",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/privacy",
  "/terms",
  "/api/webhooks/clerk",
  "/api/webhooks/stripe",
  "/api/inngest",
  "/api/health",
  // T4.10 — Vendor portal has its own auth (magic-link + DB session). Clerk
  // must not try to gate these routes; the vendor middleware
  // (`requireCurrentVendor`) is the actual access check.
  "/vendor(.*)",
]);

/**
 * Security headers applied to every response.
 *
 * Why each one:
 *   - Strict-Transport-Security: HTTPS enforcement; 2-year max-age + subdomains
 *     + preload-ready. Once shipped to prod, browsers refuse plain HTTP.
 *   - X-Content-Type-Options: blocks MIME sniffing — uploaded docs are served
 *     with explicit Content-Type; a missing/loose one used to be a CSP bypass.
 *   - X-Frame-Options=DENY: clickjacking defense. Renewal Radar is not meant
 *     to be embedded in iframes; refuse outright.
 *   - Referrer-Policy=strict-origin-when-cross-origin: don't leak the full
 *     URL (which can include sensitive params) to third-party origins.
 *   - Permissions-Policy: deny browser features we don't use.
 *   - Content-Security-Policy: restricts script/connect to known origins.
 *     `unsafe-inline` is required for Clerk's hosted widgets and Next's
 *     hydration; everything else stays tight.
 *
 * NOTE: CSP nonces would be the gold standard. Until we wire Next.js's
 * built-in nonce middleware, `unsafe-inline` stays — but only for styles
 * and scripts strictly required by Clerk + Next hydration.
 */
function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()"
  );
  // CSP: Clerk needs script + connect to clerk.com and clerk.accounts.dev;
  // Sentry needs connect to ingest.sentry.io if wired. Stripe Elements
  // (not yet integrated) would need js.stripe.com. Add as needed when the
  // integration lands.
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.com https://*.clerk.accounts.dev https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.clerk.com https://*.clerk.accounts.dev https://*.ingest.sentry.io https://api.stripe.com",
      "frame-src 'self' https://*.clerk.com https://challenges.cloudflare.com https://js.stripe.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  return res;
}

const realMiddleware = clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    auth().protect();
  }
  return applySecurityHeaders(NextResponse.next());
});

// In demo mode, skip Clerk entirely — no auth check, no provider context wiring.
const demoMiddleware = (_req: NextRequest) =>
  applySecurityHeaders(NextResponse.next());

export default isDemoMode ? demoMiddleware : realMiddleware;

export const config = {
  matcher: [
    // Skip Next.js internals and static files unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
