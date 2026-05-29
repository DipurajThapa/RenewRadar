import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

// Load .env.test first (test-only DATABASE_URL_TEST etc.) then .env.local as a
// fallback for shared settings. Done here rather than at test-runtime so the
// env is in place before any test imports the DB client (which reads
// DATABASE_URL at import time).
loadEnv({ path: ".env.test" });
loadEnv({ path: ".env.local" });

const srcUrl = new URL("./src", import.meta.url).pathname;

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    typecheck: { enabled: false },
    coverage: {
      // Enforced floors. Failing CI when coverage drops protects the
      // shape of testing — we can't ship new code paths without tests
      // and silently watch coverage erode.
      //
      // Targets chosen pragmatically:
      //   - Global 65% — the current behavioural surface
      //   - Domain 90% — pure functions, no excuse for sub-90
      //   - Application 75% — repository-heavy, harder to push higher
      //     without slowing the suite
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/server/**/*.ts", "src/shared/**/*.ts"],
      exclude: [
        "**/__tests__/**",
        "**/*.test.ts",
        "**/types.ts",
        "src/server/infrastructure/db/schema.ts",
        "src/server/jobs/client.ts",
      ],
      // Floors set at current real coverage (measured 2026-05-28) minus a
      // small margin for non-deterministic measurement. The job is to
      // PREVENT REGRESSION, not aspirational claims. As tests are added
      // (P6.18 covers the cron jobs) these floors should be raised.
      // Domain coverage is dragged down by data files (FEATURE_MATRIX,
      // event-labels) that are configuration, not behaviour — they don't
      // need tests, just don't ever shrink them.
      thresholds: {
        statements: 58,
        branches: 48,
        functions: 60,
        lines: 58,
        "src/server/domain/**/*.ts": {
          statements: 48,
          branches: 35,
          functions: 45,
          lines: 48,
        },
        "src/server/application/**/*.ts": {
          statements: 58,
          branches: 45,
          functions: 58,
          lines: 58,
        },
      },
    },
  },
  resolve: {
    alias: {
      // Path aliases mirror tsconfig.json. The legacy "@" alias was retired
      // after the SDLC layering refactor — every import now uses one of the
      // layered aliases below.
      "@app": `${srcUrl}/app`,
      "@server": `${srcUrl}/server`,
      "@ui": `${srcUrl}/ui`,
      "@shared": `${srcUrl}/shared`,
    },
  },
});
