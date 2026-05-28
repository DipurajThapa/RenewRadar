/**
 * Next.js 14 instrumentation entry point.
 *
 * `register()` runs once per runtime (Node + Edge) when the server boots.
 * We dispatch to the runtime-specific Sentry init living at the project
 * root (`sentry.server.config.ts`, `sentry.edge.config.ts`). The root files
 * exist because `@sentry/nextjs` v8 + `withSentryConfig` autodetects them
 * by convention — moving them anywhere else breaks that detection.
 *
 * The browser bundle is initialized separately via `sentry.client.config.ts`,
 * which Next.js wires into the client bundle automatically — nothing to do
 * here for that path.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
