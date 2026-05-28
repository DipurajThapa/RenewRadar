import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

// Load .env.test first (test-only DATABASE_URL_TEST etc.) then .env.local as a
// fallback for shared settings. Done here rather than at test-runtime so the
// env is in place before any test imports `src/lib/db` (which reads
// DATABASE_URL at import time).
loadEnv({ path: ".env.test" });
loadEnv({ path: ".env.local" });

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    // The DB-backed isolation suite is sequential by design (truncate-between-tests).
    // Run everything in a single fork so the suites share one connection pool.
    pool: "forks",
    // Run all test files in a single fork so the DB-backed suite can rely on
    // serial truncate-between-tests semantics without contention.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Vitest 4 supports tsconfig path aliases natively without a plugin.
    typecheck: { enabled: false },
  },
  // tsconfigPaths config goes under top-level `resolve` in Vitest 4
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
