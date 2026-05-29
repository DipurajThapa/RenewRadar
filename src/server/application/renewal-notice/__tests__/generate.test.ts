/**
 * A3 — generateAndStoreNoticeDraft + updateNoticeDraftBody (DB-backed).
 * Composes an INTERNAL memo from the latest brief, persists it, audits it, and
 * never crosses the account boundary. Edits flip status to 'edited'.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  auditLogTable,
  renewalNoticeDraftsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  ensureVendor,
  createSubscriptionWithRenewalEvent,
} from "@server/application/subscriptions";
import { generateAndStoreBrief } from "@server/application/renewal-brief";
import {
  generateAndStoreNoticeDraft,
  updateNoticeDraftBody,
  RenewalNoticeError,
} from "@server/application/renewal-notice";

let accountId: string;
let userId: string;
let subscriptionId: string;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Notice Co", billingEmail: "n@n.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "o@n.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  userId = user!.id;
  const vendor = await ensureVendor({ accountId, name: "Datadog" });
  const sub = await createSubscriptionWithRenewalEvent({
    accountId,
    actorUserId: userId,
    vendorId: vendor.id,
    data: {
      productName: "Pro",
      billingCycle: "annual",
      termStartDate: "2025-01-01",
      termEndDate: "2026-12-31",
      autoRenew: true,
      noticePeriodDays: 30,
      totalSeats: 1,
      unitPriceCents: 600_000,
    },
  });
  subscriptionId = sub.id;
});

async function makeBrief() {
  await generateAndStoreBrief({
    accountId,
    subscriptionId,
    actorUserId: userId,
    today: new Date("2026-10-01"),
  });
}

describe("generateAndStoreNoticeDraft", () => {
  it("throws when there is no brief to compose from", async () => {
    await expect(
      generateAndStoreNoticeDraft({ accountId, subscriptionId, actorUserId: userId })
    ).rejects.toBeInstanceOf(RenewalNoticeError);
  });

  it("persists an INTERNAL draft linked to the brief, audited", async () => {
    await makeBrief();
    const draft = await generateAndStoreNoticeDraft({
      accountId,
      subscriptionId,
      actorUserId: userId,
    });
    expect(draft.status).toBe("draft");
    expect(draft.renewalBriefId).not.toBeNull();
    expect(draft.subject).toContain("Internal renewal notice");
    expect(draft.bodyText).toContain("INTERNAL MEMO");
    expect(draft.bodyText).not.toMatch(/To Whom It May Concern/i);

    const audit = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.accountId, accountId),
          eq(auditLogTable.action, "renewal_notice.drafted")
        )
      );
    expect(audit).toHaveLength(1);
  });

  it("edit flips status to 'edited' and audits", async () => {
    await makeBrief();
    const draft = await generateAndStoreNoticeDraft({
      accountId,
      subscriptionId,
      actorUserId: userId,
    });
    const edited = await updateNoticeDraftBody({
      accountId,
      draftId: draft.id,
      actorUserId: userId,
      subject: "Edited subject",
      bodyText: "Edited internal memo body",
    });
    expect(edited.status).toBe("edited");
    expect(edited.subject).toBe("Edited subject");

    const audit = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "renewal_notice.edited"));
    expect(audit).toHaveLength(1);
  });

  it("cannot draft for a subscription in another account (tenant scope)", async () => {
    await makeBrief();
    const [other] = await db
      .insert(accountsTable)
      .values({ name: "Other", billingEmail: "x@x.test" })
      .returning();
    await expect(
      generateAndStoreNoticeDraft({
        accountId: other!.id,
        subscriptionId,
        actorUserId: userId,
      })
    ).rejects.toBeInstanceOf(RenewalNoticeError);
  });

  it("cannot edit another account's draft", async () => {
    await makeBrief();
    const draft = await generateAndStoreNoticeDraft({
      accountId,
      subscriptionId,
      actorUserId: userId,
    });
    const [other] = await db
      .insert(accountsTable)
      .values({ name: "Other2", billingEmail: "x2@x.test" })
      .returning();
    await expect(
      updateNoticeDraftBody({
        accountId: other!.id,
        draftId: draft.id,
        actorUserId: userId,
        subject: "hijack",
        bodyText: "hijack",
      })
    ).rejects.toBeInstanceOf(RenewalNoticeError);
    // unchanged
    const [row] = await db
      .select()
      .from(renewalNoticeDraftsTable)
      .where(eq(renewalNoticeDraftsTable.id, draft.id));
    expect(row!.status).toBe("draft");
  });
});
