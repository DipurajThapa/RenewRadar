/**
 * Vitest global setup.
 *
 * Forces tests to use the test database. We refuse to run if DATABASE_URL is
 * pointing at anything that doesn't have `_test` in the database name — this
 * is the only safeguard against accidentally truncating the dev DB when a
 * developer forgets to set DATABASE_URL_TEST. The check runs once at process
 * start, before any test imports `src/lib/db`.
 */

const explicitTestUrl = process.env.DATABASE_URL_TEST;
if (explicitTestUrl) {
  process.env.DATABASE_URL = explicitTestUrl;
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "[vitest.setup] DATABASE_URL (or DATABASE_URL_TEST) must be set. " +
      "Default test DB: postgresql://<you>@localhost:5432/renewal_radar_test"
  );
}

// Reject any URL whose database segment doesn't end in `_test`. This is
// intentionally strict — the price of a false positive (rename your test DB)
// is much smaller than the price of a false negative (truncating prod-like data).
const lastSegment = url.split("?")[0]!.split("/").pop() ?? "";
if (!lastSegment.endsWith("_test")) {
  throw new Error(
    `[vitest.setup] Refusing to run tests against database "${lastSegment}". ` +
      `Set DATABASE_URL_TEST to a URL whose database name ends in "_test".`
  );
}

// Be loud once so the test header shows where we're pointed.
// (Vitest swallows console.log on green runs unless --reporter=verbose, which is fine.)
// eslint-disable-next-line no-console
console.log(`[vitest] Using test database: ${lastSegment}`);
