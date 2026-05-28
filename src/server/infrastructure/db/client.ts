import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// `prepare: false` is required for Neon's serverless-ready pooled connection.
// `max: 1` is appropriate for serverless/edge runtimes where each invocation
// gets its own connection; for long-lived Node servers, raise this.
const client = postgres(connectionString, {
  prepare: false,
  max: 1,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
