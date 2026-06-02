import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Pool size. Defaults to 1 — DO NOT raise without care: parts of the app are
// written against single-connection serialization (e.g. the AI-pages budget
// cap's per-account advisory lock and the spend-reconcile nested-transaction
// ordering, which deadlocks if transactions can run truly concurrently on
// separate connections). Raising this needs those paths hardened first; it is
// gated behind DATABASE_POOL_MAX so it's a deliberate, tested operational
// choice — never an accident. The connection LEAK fixed below is independent
// of pool size (it was caused by re-creating the pool, not by its size).
const POOL_MAX = (() => {
  const raw = Number(process.env.DATABASE_POOL_MAX);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
})();

// Singleton guard — THE leak fix. Next.js dev HMR (and any module
// re-evaluation) would otherwise re-run this module and open a brand-new pool
// on every reload while the previous pool's sockets stay open — they
// accumulate until Postgres hits `max_connections` and every query fails with
// "too many clients already" (a full app outage; observed live). Caching the
// postgres-js client + drizzle instance on `globalThis` makes re-imports reuse
// the one pool. `idle_timeout`/`max_lifetime` also let any stray socket
// self-reap rather than leak permanently.
type DbGlobal = typeof globalThis & {
  __rrPgClient?: ReturnType<typeof postgres>;
  __rrDb?: ReturnType<typeof drizzle<typeof schema>>;
};
const g = globalThis as DbGlobal;

const client =
  g.__rrPgClient ??
  postgres(connectionString, {
    // `prepare: false` is required for pooled (e.g. Neon/pgbouncer) connections.
    prepare: false,
    max: POOL_MAX,
    // Reap idle connections after 20s so a transient burst doesn't pin sockets.
    idle_timeout: 20,
    // Recycle a connection after 30 min to bound long-lived socket leaks.
    max_lifetime: 60 * 30,
  });

export const db = g.__rrDb ?? drizzle(client, { schema });
export type DB = typeof db;

// Persist the singletons in non-production so HMR reuses them. In production
// the module is evaluated once, so the cache is unnecessary (but harmless).
if (process.env.NODE_ENV !== "production") {
  g.__rrPgClient = client;
  g.__rrDb = db;
}
