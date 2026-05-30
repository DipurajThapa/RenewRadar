/**
 * retrieveFacts (P3-S2) — the deterministic retrieval dispatch. Verifies that
 * each intent pulls real, account-scoped facts with source refs + deep-links,
 * resolves a vendor named in the question, and never leaks across accounts.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
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

describe("retrieveFacts", () => {
  it("returns account-risk facts with a deep-link", async () => {
    const facts = await retrieveFacts(ids.accountA.id, "account_risk", "biggest risk?");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]?.source).toBe("account_risk");
    expect(facts.some((f) => f.href === "/action-queue")).toBe(true);
  });

  it("resolves a vendor named in the question for vendor_spend", async () => {
    const facts = await retrieveFacts(
      ids.accountA.id,
      "vendor_spend",
      "how much do we spend on Vendor A?"
    );
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]?.source).toBe("vendor_intelligence");
    expect(facts[0]?.href).toBe(`/vendors/${ids.accountA.vendorId}`);
  });

  it("returns nothing when no vendor in the question matches the account", async () => {
    const facts = await retrieveFacts(
      ids.accountA.id,
      "vendor_spend",
      "how much do we spend on Nonexistent Corp?"
    );
    expect(facts).toEqual([]);
  });

  it("returns KPI facts for the kpis intent", async () => {
    const facts = await retrieveFacts(ids.accountA.id, "kpis", "overview");
    expect(facts).toHaveLength(1);
    expect(facts[0]?.source).toBe("kpis");
    expect(facts[0]?.href).toBe("/dashboard");
  });

  it("is account-scoped — account B can't see account A's vendor", async () => {
    const facts = await retrieveFacts(
      ids.accountB.id,
      "vendor_spend",
      "how much do we spend on Vendor A?"
    );
    expect(facts).toEqual([]); // "Vendor A" isn't B's vendor
  });

  it("returns [] for the unknown intent", async () => {
    expect(await retrieveFacts(ids.accountA.id, "unknown", "huh?")).toEqual([]);
  });
});
