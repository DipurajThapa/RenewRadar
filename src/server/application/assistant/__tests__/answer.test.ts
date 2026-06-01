/**
 * answerAccountQuestion (P3-S3) — the end-to-end grounded composer
 * (classify → retrieve → reason → validate). Every answer claim must be backed
 * by a retrieved fact, the account's own data only, and an unmappable question
 * gets an honest "no data" answer.
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
import { answerAccountQuestion } from "@server/application/assistant";
import { ASK_POLICY } from "@server/infrastructure/rate-limit";

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

describe("answerAccountQuestion", () => {
  it("answers a risk question grounded in the account's data", async () => {
    const ans = await answerAccountQuestion(ids.accountA.id, "what's my biggest risk?");
    expect(ans.answers.length).toBeGreaterThan(0);
    // Every emitted claim carries evidence (the honesty gate).
    expect(ans.answers.every((a) => a.evidence.length > 0)).toBe(true);
    expect(ans.deepLinks.some((d) => d.href === "/action-queue")).toBe(true);
    expect(ans.meta.engine).toBe("deterministic");
  });

  it("resolves a vendor named in the question", async () => {
    const ans = await answerAccountQuestion(
      ids.accountA.id,
      "how much do we spend on Vendor A?"
    );
    expect(ans.answers.length).toBeGreaterThan(0);
    expect(
      ans.answers.some((a) => a.evidence.some((e) => e.source === "vendor_intelligence"))
    ).toBe(true);
  });

  it("gives an honest 'no data' answer for an unmappable question", async () => {
    const ans = await answerAccountQuestion(ids.accountA.id, "what's the weather?");
    expect(ans.answers).toEqual([]);
    expect(ans.summary.toLowerCase()).toContain("couldn't find");
    expect(ans.missingInfo.length).toBeGreaterThan(0);
  });

  it("never answers with another account's vendor data", async () => {
    const ans = await answerAccountQuestion(
      ids.accountB.id,
      "how much do we spend on Vendor A?"
    );
    // "Vendor A" isn't B's vendor → no facts → honest no-data.
    expect(ans.answers).toEqual([]);
  });

  it("ASK_POLICY is wired with sane limits", () => {
    expect(ASK_POLICY.limit).toBeGreaterThan(0);
    expect(ASK_POLICY.windowSeconds).toBeGreaterThan(0);
  });
});
