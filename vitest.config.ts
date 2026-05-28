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
