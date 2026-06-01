/**
 * Multi-document synthesis (Phase 3/A) — a comparative question ("which of my
 * subscriptions has the strictest notice period?") gathers a comparable fact from
 * EACH of the account's contracts and the reasoner answers grounded ACROSS them.
 * Neither the keyword router nor a single-intent dispatch expresses this.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@server/infrastructure/db/client";
import { subscriptionsTable, vendorsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { classifyIntent } from "@server/domain/assistant/intent";
import { retrieveFacts } from "@server/application/assistant/retrieve";
import { answerAccountQuestion } from "@server/application/assistant";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  // Account A now has TWO contracts (the seed's Product A @ 30-day notice + this
  // one @ 90-day notice) — so a "strictest notice" question must compare them.
  const [v2] = await db
    .insert(vendorsTable)
    .values({ accountId: ids.accountA.id, name: "Globex" })
    .returning();
  await db.insert(subscriptionsTable).values({
    accountId: ids.accountA.id,
    vendorId: v2!.id,
    productName: "Analytics",
    billingCycle: "monthly",
    termStartDate: "2026-01-01",
    termEndDate: "2026-12-31",
    autoRenew: false,
    noticePeriodDays: 90,
    totalSeats: 3,
    unitPriceCents: 5_000,
    totalCostPerPeriodCents: 15_000,
    status: "active",
  });
});

describe("classifyIntent → cross_document", () => {
  it("routes self-scoped comparatives to cross_document", () => {
    expect(classifyIntent("which of my subscriptions has the strictest notice period?")).toBe("cross_document");
    expect(classifyIntent("compare my contracts by cost")).toBe("cross_document");
    expect(classifyIntent("list all my renewals")).toBe("cross_document");
  });

  it("still routes cross-ACCOUNT comparisons to vendor_benchmark", () => {
    expect(classifyIntent("how does Globex compare to peers?")).toBe("vendor_benchmark");
  });
});

describe("multi-document retrieval + synthesis", () => {
  it("gathers one fact per contract (multiple documents)", async () => {
    const facts = await retrieveFacts(ids.accountA.id, "cross_document", "which has the strictest notice?");
    expect(facts.length).toBe(2);
    const refs = new Set(facts.map((f) => f.refId));
    expect(refs.size).toBe(2); // two distinct subscriptions
    expect(facts.some((f) => f.detail.includes("notice 90 days"))).toBe(true);
    expect(facts.some((f) => f.detail.includes("notice 30 days"))).toBe(true);
  });

  it("answers grounded ACROSS both contracts", async () => {
    const ans = await answerAccountQuestion(
      ids.accountA.id,
      "which of my subscriptions has the strictest notice period?"
    );
    expect(ans.answers.length).toBeGreaterThanOrEqual(2);
    const refIds = new Set(ans.answers.flatMap((a) => a.evidence.map((e) => e.refId)));
    expect(refIds.size).toBeGreaterThanOrEqual(2); // synthesis spans ≥2 documents
    expect(ans.answers.every((a) => a.evidence.length > 0)).toBe(true); // grounded
  });

  it("is tenant-scoped — account B only sees its own contracts", async () => {
    const facts = await retrieveFacts(ids.accountB.id, "cross_document", "list all my subscriptions");
    expect(facts.every((f) => f.detail.includes("Vendor B"))).toBe(true);
    expect(facts.every((f) => !f.detail.includes("Globex"))).toBe(true);
  });
});
