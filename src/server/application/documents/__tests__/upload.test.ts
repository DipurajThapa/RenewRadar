/**
 * uploadDocument tests — money path + guard rails.
 *
 * Audit gap C4: pre-fix the upload use case was 100% untested. It governs
 * AI-pages budget reservation, cross-account subscription rejection, MIME
 * allow-listing, and the contract_uploaded vendor event emission.
 *
 * Covered:
 *   - 0-byte file rejected
 *   - >20 MB file rejected
 *   - Disallowed MIME rejected (UI client-side allow-list is wider; the
 *     server MUST refuse anything not in the parser allow-list)
 *   - Cross-account subscriptionId rejected (defense-in-depth)
 *   - Dedup: same bytes uploaded twice returns the existing row, never
 *     creates a second document, no double-charge of budget
 *   - Cap pre-check: at-cap account is refused before any storage write
 *   - contract_uploaded vendor event emitted when linked to a subscription
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  aiExtractionRunsTable,
  documentsTable,
  vendorEventsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  DocumentUploadError,
  uploadDocument,
} from "@server/application/documents/upload";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

const PDF_HEADER = Buffer.from("%PDF-1.4\nfake pdf body for tests", "utf-8");

describe("uploadDocument input validation", () => {
  it("rejects a 0-byte file", async () => {
    await expect(
      uploadDocument({
        accountId: ids.accountA.id,
        accountPlanTier: "starter",
        uploadedByUserId: ids.accountA.userId,
        filename: "empty.pdf",
        mimeType: "application/pdf",
        bytes: Buffer.alloc(0),
      })
    ).rejects.toBeInstanceOf(DocumentUploadError);
  });

  it("rejects a file larger than 20 MB", async () => {
    await expect(
      uploadDocument({
        accountId: ids.accountA.id,
        accountPlanTier: "starter",
        uploadedByUserId: ids.accountA.userId,
        filename: "big.pdf",
        mimeType: "application/pdf",
        bytes: Buffer.alloc(20 * 1024 * 1024 + 1, 0),
      })
    ).rejects.toBeInstanceOf(DocumentUploadError);
  });

  it("rejects a disallowed MIME type", async () => {
    await expect(
      uploadDocument({
        accountId: ids.accountA.id,
        accountPlanTier: "starter",
        uploadedByUserId: ids.accountA.userId,
        filename: "binary.bin",
        mimeType: "application/octet-stream",
        bytes: PDF_HEADER,
      })
    ).rejects.toBeInstanceOf(DocumentUploadError);
  });
});

describe("uploadDocument tenant scoping", () => {
  it("rejects a cross-account subscriptionId", async () => {
    // Try to attach an upload-to-account-A document to account B's
    // subscription. Defense-in-depth — the form is server-rendered so
    // crafting this requires bypassing the UI.
    await expect(
      uploadDocument({
        accountId: ids.accountA.id,
        accountPlanTier: "starter",
        uploadedByUserId: ids.accountA.userId,
        subscriptionId: ids.accountB.subscriptionId,
        filename: "leak.pdf",
        mimeType: "application/pdf",
        bytes: PDF_HEADER,
      })
    ).rejects.toBeInstanceOf(DocumentUploadError);
  });
});

/** Seed a "document + completed run" pair to consume the monthly budget. */
async function consumeBudget(
  accountId: string,
  uploadedByUserId: string,
  pages: number
): Promise<void> {
  const [doc] = await db
    .insert(documentsTable)
    .values({
      accountId,
      uploadedByUserId,
      kind: "contract" as const,
      filename: `consume-${Date.now()}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1000,
      storageKey: `test/consume-${Date.now()}.pdf`,
      checksumSha256: `dummy-${Date.now()}`,
      textExtractionStatus: "ready" as const,
    })
    .returning();
  if (!doc) throw new Error("seed doc failed");
  await db.insert(aiExtractionRunsTable).values({
    accountId,
    documentId: doc.id,
    provider: "test-stub",
    model: "test",
    promptVersion: "v1",
    status: "succeeded",
    pagesCharged: pages,
    startedAt: new Date(),
  });
}

describe("uploadDocument cap pre-check", () => {
  it("refuses uploads when the account is already at the monthly cap", async () => {
    await consumeBudget(ids.accountA.id, ids.accountA.userId, 200);

    await expect(
      uploadDocument({
        accountId: ids.accountA.id,
        accountPlanTier: "starter",
        uploadedByUserId: ids.accountA.userId,
        filename: "at-cap.pdf",
        mimeType: "application/pdf",
        bytes: PDF_HEADER,
      })
    ).rejects.toThrow(/200 of 200/);
  });

  it("free_forever rejects uploads beyond the 5-page cap", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "free_forever" })
      .where(eq(accountsTable.id, ids.accountA.id));
    await consumeBudget(ids.accountA.id, ids.accountA.userId, 5);
    await expect(
      uploadDocument({
        accountId: ids.accountA.id,
        accountPlanTier: "free_forever",
        uploadedByUserId: ids.accountA.userId,
        filename: "over-free.pdf",
        mimeType: "application/pdf",
        bytes: PDF_HEADER,
      })
    ).rejects.toThrow(/Upgrade to Starter/);
  });
});

describe("uploadDocument dedup by checksum", () => {
  it("returns the existing row + alreadyExisted=true on a re-upload", async () => {
    const first = await uploadDocument({
      accountId: ids.accountA.id,
      accountPlanTier: "starter",
      uploadedByUserId: ids.accountA.userId,
      filename: "contract.pdf",
      mimeType: "application/pdf",
      bytes: PDF_HEADER,
    });
    expect(first.alreadyExisted).toBe(false);

    const second = await uploadDocument({
      accountId: ids.accountA.id,
      accountPlanTier: "starter",
      uploadedByUserId: ids.accountA.userId,
      filename: "contract-renamed.pdf", // different name, same bytes
      mimeType: "application/pdf",
      bytes: PDF_HEADER,
    });
    expect(second.alreadyExisted).toBe(true);
    expect(second.document.id).toBe(first.document.id);

    // Only one document row exists — dedup discarded the second write.
    const rows = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.accountId, ids.accountA.id));
    expect(rows.length).toBe(1);
  });
});

describe("uploadDocument vendor events", () => {
  it("emits a contract_uploaded vendor event when linked to a subscription", async () => {
    await uploadDocument({
      accountId: ids.accountA.id,
      accountPlanTier: "starter",
      uploadedByUserId: ids.accountA.userId,
      subscriptionId: ids.accountA.subscriptionId,
      filename: "linked.pdf",
      mimeType: "application/pdf",
      bytes: PDF_HEADER,
    });

    const events = await db
      .select()
      .from(vendorEventsTable)
      .where(
        and(
          eq(vendorEventsTable.accountId, ids.accountA.id),
          eq(vendorEventsTable.kind, "contract_uploaded")
        )
      );
    expect(events.length).toBe(1);
    expect(events[0]?.vendorId).toBe(ids.accountA.vendorId);
    expect(events[0]?.subscriptionId).toBe(ids.accountA.subscriptionId);
  });

  it("does NOT emit a vendor event when the upload is not linked", async () => {
    await uploadDocument({
      accountId: ids.accountA.id,
      accountPlanTier: "starter",
      uploadedByUserId: ids.accountA.userId,
      // no subscriptionId — orphan upload
      filename: "orphan.pdf",
      mimeType: "application/pdf",
      bytes: PDF_HEADER,
    });

    const events = await db
      .select()
      .from(vendorEventsTable)
      .where(
        and(
          eq(vendorEventsTable.accountId, ids.accountA.id),
          eq(vendorEventsTable.kind, "contract_uploaded")
        )
      );
    expect(events.length).toBe(0);
  });
});
