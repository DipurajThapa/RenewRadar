import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { leadsTable } from "@server/infrastructure/db/schema";
import { captureLead } from "@server/application/leads";
import {
  _resetCrmProviderForTests,
  type CrmProvider,
  type LeadPushPayload,
} from "@server/infrastructure/crm";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";

/**
 * DB-backed tests for the public lead-capture use case.
 *
 * Each test starts from a clean state via `truncateAll`. The CRM provider
 * is swapped for a capturing fake so we can assert that pushes happen
 * without hitting any real HTTP endpoint.
 */

class CapturingCrm implements CrmProvider {
  readonly providerName = "test-capture";
  pushed: LeadPushPayload[] = [];
  async pushLead(payload: LeadPushPayload): Promise<{ ok: boolean }> {
    this.pushed.push(payload);
    return { ok: true };
  }
}

let crm: CapturingCrm;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  crm = new CapturingCrm();
  _resetCrmProviderForTests(crm);
});

afterAll(() => {
  _resetCrmProviderForTests();
});

describe("captureLead", () => {
  it("writes a new lead and pushes it to the CRM", async () => {
    const result = await captureLead({
      email: "First.Lead@Example.com",
      fullName: "First Lead",
      company: "Acme",
      jobTitle: "IT Director",
      message: "Need a demo for 60 subs",
      source: "marketing_pricing_enterprise",
      intent: "enterprise",
      consentMarketing: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Email is normalized to lower-case + trimmed by the validator.
    expect(result.lead.email).toBe("first.lead@example.com");
    expect(result.lead.fullName).toBe("First Lead");
    expect(result.lead.company).toBe("Acme");
    expect(result.lead.consentMarketing).toBe(true);
    expect(result.lead.status).toBe("new");

    const rows = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.email, "first.lead@example.com"));
    expect(rows).toHaveLength(1);

    // CRM push is fire-and-forget — give the microtask queue one tick.
    await Promise.resolve();
    expect(crm.pushed).toHaveLength(1);
    expect(crm.pushed[0]!.email).toBe("first.lead@example.com");
    expect(crm.pushed[0]!.source).toBe("marketing_pricing_enterprise");
  });

  it("upserts on email and updates the row in place", async () => {
    await captureLead({
      email: "repeat@example.com",
      fullName: "Old Name",
      company: null,
      source: "marketing_home_final_cta",
      intent: "demo",
    });
    await captureLead({
      email: "repeat@example.com",
      fullName: "New Name",
      company: "Bigger Co",
      source: "marketing_pricing_enterprise",
      intent: "enterprise",
    });

    const rows = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.email, "repeat@example.com"));

    // Only one row — the email unique constraint debounced the duplicate.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe("New Name");
    expect(rows[0]!.company).toBe("Bigger Co");
    // Most recent source wins so the marketing team sees where they are now.
    expect(rows[0]!.source).toBe("marketing_pricing_enterprise");
    // Status is reset to "new" so the row resurfaces in the CRM queue.
    expect(rows[0]!.status).toBe("new");
  });

  it("silently drops bot submissions when the honeypot is filled", async () => {
    const result = await captureLead({
      email: "bot@example.com",
      source: "marketing_home_final_cta",
      honeypot: "https://spammer.example",
    });
    // Caller sees success so the bot can't tune around an error code.
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.email, "bot@example.com"));
    expect(rows).toHaveLength(0);

    // No CRM push either.
    await Promise.resolve();
    expect(crm.pushed).toHaveLength(0);
  });

  it("rejects invalid email shape with a friendly error", async () => {
    const result = await captureLead({
      email: "not-an-email",
      source: "marketing_home_final_cta",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/check your details/i);

    const rows = await db.select().from(leadsTable);
    expect(rows).toHaveLength(0);
  });

  it("survives a CRM provider that always fails", async () => {
    class ExplodingCrm implements CrmProvider {
      readonly providerName = "exploding";
      async pushLead(): Promise<{ ok: boolean }> {
        throw new Error("simulated outage");
      }
    }
    _resetCrmProviderForTests(new ExplodingCrm());

    const result = await captureLead({
      email: "resilient@example.com",
      source: "marketing_home_final_cta",
    });
    expect(result.ok).toBe(true);

    // Row still landed in the DB — CRM outage must not block the lead.
    const rows = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.email, "resilient@example.com"));
    expect(rows).toHaveLength(1);
  });

  it("ignores unknown source values via the Zod enum", async () => {
    const result = await captureLead({
      // @ts-expect-error — exercising the runtime validator
      source: "not_a_real_source",
      email: "fake@example.com",
    });
    expect(result.ok).toBe(false);
  });
});
