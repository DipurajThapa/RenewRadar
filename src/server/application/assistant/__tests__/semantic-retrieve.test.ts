/**
 * Semantic retrieval (Phase 3/A) is LOAD-BEARING: for an off-menu (`unknown`-
 * intent) question, the deterministic keyword dispatch returns [] by construction,
 * but the embedding-ranked retriever surfaces the account's genuinely-relevant
 * facts. It stays grounded (facts are real account data) and tenant-scoped.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { renewalEventsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { retrieveFacts } from "@server/application/assistant/retrieve";
import { semanticRetrieveFacts } from "@server/application/assistant/semantic-retrieve";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  await db
    .update(renewalEventsTable)
    .set({ status: "notice_window" })
    .where(eq(renewalEventsTable.id, ids.accountA.renewalEventId));
});

describe("semantic retrieval is load-bearing for off-menu questions", () => {
  it("surfaces relevant facts the keyword dispatch returns [] for", async () => {
    const q = "tell me about anything risk related I should look at";
    // The keyword/unknown dispatch is structurally empty for `unknown`.
    expect(await retrieveFacts(ids.accountA.id, "unknown", q)).toEqual([]);
    // Semantic retrieval ranks the account's real facts and surfaces the relevant ones.
    const facts = await semanticRetrieveFacts(ids.accountA.id, q, "unknown");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.detail.toLowerCase().includes("risk"))).toBe(true);
  });

  it("returns honest [] for a truly unrelated question (no answering from noise)", async () => {
    const facts = await semanticRetrieveFacts(ids.accountA.id, "what's the weather today?", "unknown");
    expect(facts).toEqual([]);
  });

  it("is tenant-scoped — account B never sees account A's vendor", async () => {
    const facts = await semanticRetrieveFacts(ids.accountB.id, "risk on Vendor A", "unknown");
    // B may surface its OWN risk facts, but never account A's vendor.
    expect(facts.every((f) => !f.detail.includes("Vendor A"))).toBe(true);
  });

  it("leaves a CLASSIFIED intent on its precise dispatch (no weakening)", async () => {
    // intent !== unknown → identical to the deterministic dispatch.
    const semantic = await semanticRetrieveFacts(ids.accountA.id, "what's my biggest risk?", "account_risk");
    const deterministic = await retrieveFacts(ids.accountA.id, "account_risk", "what's my biggest risk?");
    expect(semantic).toEqual(deterministic);
  });
});
