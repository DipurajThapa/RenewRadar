import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * Separate build output directories for `next dev` and `next build`.
   *
   * Why: `next dev` and `next build` both write to `.next` by default.
   * Running `next build` while `next dev` is up (or even after dev has
   * been stopped) replaces the dev server's compiled chunks with
   * production artefacts that have different content hashes. The HTML
   * shell the dev server keeps serving still references the old chunk
   * names, so the browser gets 404s on every CSS + JS asset — the page
   * loads as raw unstyled HTML. Restarting dev "fixes" it, until the
   * next build.
   *
   * The fix is to give each command its own folder:
   *   - dev   → .next        (default, no env var)
   *   - build → .next-build  (BUILD_DIR env var set in `pnpm build`)
   *
   * `start` reads the same BUILD_DIR so `pnpm build && pnpm start`
   * still works end-to-end in production.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Enables src/instrumentation.ts (Next.js 14). Auto-on in 15+.
    instrumentationHook: true,
    serverActions: {
      // Headroom for CSV imports — the import dialog parses the blob server-side.
      bodySizeLimit: "5mb",
    },
    // pdf-parse v2 transitively imports pdfjs-dist@5's ESM build, which
    // throws "Object.defineProperty called on non-object" the moment Next's
    // webpack tries to evaluate it inside the server bundle. Marking the
    // package external tells Next to keep it as a Node require at runtime,
    // sidestepping the broken ESM resolution. pdfjs-dist is listed defensively
    // in case the transitive resolution ever surfaces directly.
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=()",
          },
        ],
      },
    ];
  },
};

// Wrap with Sentry if we have credentials. In dev (no SENTRY_AUTH_TOKEN),
// withSentryConfig is a passthrough that won't break builds.
const sentryOptions = {
  silent: process.env.NODE_ENV !== "production",
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
};

export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryOptions)
  : nextConfig;
