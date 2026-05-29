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
 *
 * P7.1 — also runs a boot-time schema check that fails fast (and loud)
 * when the running DB is missing columns the code expects. Closes the
 * "stale dev DB silently breaks dashboard" failure mode that surfaced
 * after Phase 6.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Skip the schema check when there's no DB URL — covers build / CI
    // lint phases that boot the runtime without connecting. Also skip
    // when SKIP_SCHEMA_CHECK=1 (rare ops escape hatch).
    if (process.env.DATABASE_URL) {
      const { verifySchema } = await import(
        "@server/infrastructure/db/schema-check"
      );
      // verifySchema throws SchemaDriftError on drift. We let it bubble
      // so Next refuses to start serving requests against a stale DB.
      await verifySchema();
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
