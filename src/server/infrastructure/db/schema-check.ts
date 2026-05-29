/**
 * Boot-time schema verification.
 *
 * Catches the failure mode that bit us in production: the codebase imports
 * new columns from `schema.ts` (e.g. `past_due_since`) but the running
 * database doesn't have them, so the first SQL query that touches the
 * column blows up mid-request with a Postgres `column does not exist`
 * error. Static checks (typecheck, build) can't see this because they
 * have no DB.
 *
 * The check: at process start, query a sentinel column from each table
 * that has been modified by recent migrations. If a SELECT for the column
 * raises, throw immediately with a runbook-shaped message so the operator
 * knows EXACTLY how to recover (run `pnpm db:migrate`).
 *
 * Why a sentinel and not the full migration ledger:
 *   - `drizzle.__drizzle_migrations` exists, but reading it pin-locks
 *     the boot to the migration runner's own bookkeeping. A bug there
 *     would silently mask drift.
 *   - Picking one column per recent migration is enough to catch real
 *     drift: if migration N is missing, its sentinel column is missing.
 *
 * Disabled when DATABASE_URL is unset (build phase, CI lints) or when
 * SKIP_SCHEMA_CHECK=1 (rare ops escape hatch, never default).
 */
import { sql } from "drizzle-orm";
import { db } from "./client";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "db.schema_check" });

/**
 * One row per recent migration's "smoke-test" column. When you add a new
 * migration with a new column the application reads, add an entry here.
 * The check is one SELECT per row but bounded by the list size.
 */
const SENTINEL_COLUMNS: ReadonlyArray<{
  table: string;
  column: string;
  /** Migration filename for the operator's error message. */
  introducedIn: string;
}> = [
  // 0008 — ICS DoS fix
  {
    table: "integration",
    column: "token_lookup_hash",
    introducedIn: "0008_perpetual_hellcat.sql",
  },
  // 0009 — past-due grace bound
  {
    table: "account",
    column: "past_due_since",
    introducedIn: "0009_mysterious_namorita.sql",
  },
  // 0010 — over-capacity lockdown
  {
    table: "account",
    column: "lock_state",
    introducedIn: "0010_spooky_expediter.sql",
  },
  // 0011 — first-class clause columns
  {
    table: "subscription",
    column: "cancellation_method_code",
    introducedIn: "0011_majestic_omega_sentinel.sql",
  },
  {
    table: "subscription",
    column: "price_increase_clause_text",
    introducedIn: "0011_majestic_omega_sentinel.sql",
  },
  // 0012 — user soft-delete (now superseded by archive table in 0013)
  {
    table: "user",
    column: "deleted_at",
    introducedIn: "0012_blushing_virginia_dare.sql",
  },
  // 0013 — user archive table (no-delete principle)
  {
    table: "user_archive",
    column: "archived_at",
    introducedIn: "0013_user_archive.sql",
  },
];

export class SchemaDriftError extends Error {
  readonly missing: Array<{ table: string; column: string; introducedIn: string }>;
  constructor(
    missing: Array<{ table: string; column: string; introducedIn: string }>
  ) {
    const lines = missing.map(
      (m) =>
        `  - ${m.table}.${m.column}  (introduced in ${m.introducedIn})`
    );
    super(
      [
        "Database schema is behind the code. The application will crash on requests that touch these columns.",
        "",
        "Missing:",
        ...lines,
        "",
        "Recover with:",
        "  pnpm db:migrate",
        "",
        "(This check runs at boot. If you saw this in production, your deploy pipeline didn't apply migrations before traffic shifted.)",
      ].join("\n")
    );
    this.name = "SchemaDriftError";
    this.missing = missing;
  }
}

/**
 * Verify every sentinel column exists. Throws SchemaDriftError on drift,
 * resolves to void on success.
 *
 * Uses `information_schema.columns` for a single round-trip — much cheaper
 * than SELECTing each column individually.
 */
export async function verifySchema(): Promise<void> {
  if (process.env.SKIP_SCHEMA_CHECK === "1") {
    log.warn("schema_check_skipped", { reason: "SKIP_SCHEMA_CHECK=1" });
    return;
  }

  // One query, returns the columns that DO exist. We compute the missing
  // set in JS — cheaper than asking Postgres for the difference.
  const rows = await db.execute<{ table_name: string; column_name: string }>(
    sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `
  );

  const present = new Set(
    (rows as unknown as Array<{ table_name: string; column_name: string }>).map(
      (r) => `${r.table_name}.${r.column_name}`
    )
  );

  const missing = SENTINEL_COLUMNS.filter(
    (s) => !present.has(`${s.table}.${s.column}`)
  );

  if (missing.length > 0) {
    log.error("schema_drift_detected", undefined, {
      missing: missing.map((m) => `${m.table}.${m.column}`),
    });
    throw new SchemaDriftError(missing);
  }

  log.info("schema_check_ok", {
    sentinelCount: SENTINEL_COLUMNS.length,
  });
}
