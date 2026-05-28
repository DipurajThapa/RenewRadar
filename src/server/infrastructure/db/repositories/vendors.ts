import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { vendorsTable } from "@server/infrastructure/db/schema";
import type { Vendor } from "@server/infrastructure/db/schema";

export async function listVendorsByAccount(
  accountId: string
): Promise<Vendor[]> {
  return db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.accountId, accountId))
    .orderBy(asc(vendorsTable.name));
}

/**
 * Case-insensitive vendor lookup within an account.
 */
export async function findVendorByName(
  accountId: string,
  name: string
): Promise<Vendor | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const result = await db
    .select()
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.accountId, accountId),
        sql`lower(${vendorsTable.name}) = lower(${trimmed})`
      )
    )
    .limit(1);

  return result[0] ?? null;
}
