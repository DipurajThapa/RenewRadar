import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  // Loaded by Drizzle CLI from .env.local automatically via tsx/dotenv side-channel,
  // but the CLI runs outside Next.js so we need it in process.env.
  // Use `pnpm dotenv -e .env.local -- pnpm db:push` if you hit this in practice.
  console.warn(
    "[drizzle.config] DATABASE_URL not set — drizzle-kit commands will fail."
  );
}

export default defineConfig({
  schema: "./src/server/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
