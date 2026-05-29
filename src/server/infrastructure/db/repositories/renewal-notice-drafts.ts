/**
 * A3 — read layer for internal renewal-notice drafts. accountId-first on every
 * query (tenant-isolation fuse). Writes live in the application use case.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalNoticeDraftsTable,
  type RenewalNoticeDraft,
} from "@server/infrastructure/db/schema";

/** The newest non-archived draft for a subscription, or null. */
export async function getLatestNoticeDraft(
  accountId: string,
  subscriptionId: string
): Promise<RenewalNoticeDraft | null> {
  const [row] = await db
    .select()
    .from(renewalNoticeDraftsTable)
    .where(
      and(
        eq(renewalNoticeDraftsTable.accountId, accountId),
        eq(renewalNoticeDraftsTable.subscriptionId, subscriptionId)
      )
    )
    .orderBy(desc(renewalNoticeDraftsTable.createdAt))
    .limit(1);
  return row ?? null;
}

/** All drafts for a subscription, newest first. */
export async function listNoticeDrafts(
  accountId: string,
  subscriptionId: string
): Promise<RenewalNoticeDraft[]> {
  return db
    .select()
    .from(renewalNoticeDraftsTable)
    .where(
      and(
        eq(renewalNoticeDraftsTable.accountId, accountId),
        eq(renewalNoticeDraftsTable.subscriptionId, subscriptionId)
      )
    )
    .orderBy(desc(renewalNoticeDraftsTable.createdAt));
}
