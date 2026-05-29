/**
 * Cross-account vendor benchmark aggregator tests.
 *
 * The hard requirement: never disclose a benchmark when the unique
 * account count is below MIN_BENCHMARK_SAMPLE. Anything else risks
 * leaking a specific customer's contract terms.
 *
 * Also verifies:
 *   - Normalization collapses variants ("Atlassian" + "atlassian, Inc." +
 *     "ATLASSIAN LLC" all count as one vendor)
 *   - Mode of notice periods is surfaced
 *   - Auto-renew rate computed correctly
 *   - Top-N rationale codes returned in frequency order
 *   - Different vendors aren't mixed even with similar substrings
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  decisionContextsTable,
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  getVendorBenchmark,
  MIN_BENCHMARK_SAMPLE,
} from "@server/application/vendor-benchmarks";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

/**
 * Seed N accounts each with one subscription against a vendor whose
 * display name is drawn from `vendorNames` round-robin. Useful for
 * sampling "5 customers all use Atlassian Inc."
 */
async function seedSampleAccounts(opts: {
  vendorNames: string[];
  accountCount: number;
  noticePeriodDays?: number;
  autoRenew?: boolean;
  totalCostPerPeriodCents?: number;
}): Promise<{ accountIds: string[]; subscriptionIds: string[] }> {
  const accountIds: string[] = [];
  const subscriptionIds: string[] = [];

  for (let i = 0; i < opts.accountCount; i++) {
    const [account] = await db
      .insert(accountsTable)
      .values({
        name: `Acct ${i}`,
        billingEmail: `acct${i}@test.example`,
      })
      .returning();
    if (!account) throw new Error("seed account failed");
    accountIds.push(account.id);

    const [user] = await db
      .insert(usersTable)
      .values({
        accountId: account.id,
        clerkUserId: `clerk_${i}_${Date.now()}`,
        workEmail: `user${i}@acct${i}.example`,
        fullName: `User ${i}`,
      })
      .returning();
    if (!user) throw new Error("seed user failed");

    const vendorName = opts.vendorNames[i % opts.vendorNames.length]!;
    const [vendor] = await db
      .insert(vendorsTable)
      .values({ accountId: account.id, name: vendorName })
      .returning();
    if (!vendor) throw new Error("seed vendor failed");

    const today = new Date();
    const termEnd = new Date(today);
    termEnd.setUTCDate(termEnd.getUTCDate() + 60);
    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        accountId: account.id,
        vendorId: vendor.id,
        productName: "Product",
        billingCycle: "annual",
        termStartDate: today.toISOString().split("T")[0]!,
        termEndDate: termEnd.toISOString().split("T")[0]!,
        autoRenew: opts.autoRenew ?? true,
        noticePeriodDays: opts.noticePeriodDays ?? 30,
        totalSeats: 10,
        unitPriceCents: 10_000,
        totalCostPerPeriodCents: opts.totalCostPerPeriodCents ?? 120_000,
        status: "active",
        ownerUserId: user.id,
      })
      .returning();
    if (!sub) throw new Error("seed sub failed");
    subscriptionIds.push(sub.id);
  }
  return { accountIds, subscriptionIds };
}

// ─────────────────────────────────────────────────────────────────────────
// Privacy floor — the critical guarantee
// ─────────────────────────────────────────────────────────────────────────

describe("getVendorBenchmark privacy floor (N >= 3)", () => {
  it("returns null when only 1 customer has the vendor", async () => {
    await seedSampleAccounts({
      vendorNames: ["Atlassian"],
      accountCount: 1,
    });
    expect(await getVendorBenchmark("Atlassian")).toBeNull();
  });

  it("returns null when only 2 customers have the vendor", async () => {
    await seedSampleAccounts({
      vendorNames: ["Atlassian"],
      accountCount: 2,
    });
    expect(await getVendorBenchmark("Atlassian")).toBeNull();
  });

  it("returns a benchmark when 3 customers have the vendor", async () => {
    await seedSampleAccounts({
      vendorNames: ["Atlassian"],
      accountCount: 3,
    });
    const bench = await getVendorBenchmark("Atlassian");
    expect(bench).not.toBeNull();
    expect(bench?.sampleAccounts).toBeGreaterThanOrEqual(
      MIN_BENCHMARK_SAMPLE
    );
  });

  it("returns null for empty/degenerate vendor names", async () => {
    await seedSampleAccounts({
      vendorNames: ["Atlassian"],
      accountCount: 5,
    });
    expect(await getVendorBenchmark("")).toBeNull();
    expect(await getVendorBenchmark("   ")).toBeNull();
    expect(await getVendorBenchmark("Inc")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Normalization in action — variants collapse
// ─────────────────────────────────────────────────────────────────────────

describe("getVendorBenchmark normalization", () => {
  it("collapses 'Atlassian', 'atlassian', 'Atlassian Inc' into one sample", async () => {
    await seedSampleAccounts({
      vendorNames: [
        "Atlassian",
        "atlassian",
        "Atlassian Inc",
        "ATLASSIAN LLC",
      ],
      accountCount: 4,
    });
    const bench = await getVendorBenchmark("Atlassian, Inc.");
    expect(bench).not.toBeNull();
    expect(bench?.sampleAccounts).toBe(4);
  });

  it("does NOT mix different vendors that share a suffix", async () => {
    await seedSampleAccounts({
      vendorNames: ["Notion Inc", "Notion Inc", "Notion Inc"],
      accountCount: 3,
    });
    await seedSampleAccounts({
      vendorNames: ["Figma Inc"],
      accountCount: 1,
    });
    const notion = await getVendorBenchmark("Notion");
    expect(notion?.sampleAccounts).toBe(3);
    // Figma alone is below floor.
    expect(await getVendorBenchmark("Figma")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Aggregate fields
// ─────────────────────────────────────────────────────────────────────────

describe("getVendorBenchmark aggregates", () => {
  it("typical notice period is the mode across the sample", async () => {
    // 3 customers all use 60-day notice → mode = 60.
    await seedSampleAccounts({
      vendorNames: ["Slack"],
      accountCount: 3,
      noticePeriodDays: 60,
    });
    const bench = await getVendorBenchmark("Slack");
    expect(bench?.typicalNoticePeriodDays).toBe(60);
  });

  it("auto-renew rate reflects the percentage of yes subscriptions", async () => {
    await seedSampleAccounts({
      vendorNames: ["Loom"],
      accountCount: 3,
      autoRenew: true,
    });
    const bench = await getVendorBenchmark("Loom");
    expect(bench?.autoRenewRatePct).toBe(100);
  });

  it("auto-renew rate updates when some subscriptions have it off", async () => {
    // 3 with auto-renew=true.
    const t = await seedSampleAccounts({
      vendorNames: ["Vendr"],
      accountCount: 3,
      autoRenew: true,
    });
    // Add one with auto-renew=false on a new vendor row that normalizes
    // the same.
    await seedSampleAccounts({
      vendorNames: ["Vendr"],
      accountCount: 1,
      autoRenew: false,
    });
    const bench = await getVendorBenchmark("Vendr");
    expect(bench?.sampleAccounts).toBe(4);
    // 3 of 4 = 75%.
    expect(bench?.autoRenewRatePct).toBe(75);
    void t;
  });

  it("median annualized value is the contract-value median", async () => {
    // 3 contracts of 120_000 cents/yr.
    await seedSampleAccounts({
      vendorNames: ["Calendly"],
      accountCount: 3,
      totalCostPerPeriodCents: 120_000,
    });
    const bench = await getVendorBenchmark("Calendly");
    expect(bench?.medianAnnualValueCents).toBe(120_000);
  });

  it("surfaces top rationale codes when decisions have been logged", async () => {
    const seeded = await seedSampleAccounts({
      vendorNames: ["DocSign"],
      accountCount: 3,
    });

    // Move each subscription's renewal event into "decision logged" + a
    // decision_context row with rationale codes. Two contracts cite
    // "cost_reduction", one cites "low_usage".
    for (let i = 0; i < seeded.subscriptionIds.length; i++) {
      const subId = seeded.subscriptionIds[i]!;
      // Create renewal event + decision via raw inserts to avoid taking
      // the full application path here.
      const [event] = await db
        .insert(renewalEventsTable)
        .values({
          accountId: seeded.accountIds[i]!,
          subscriptionId: subId,
          renewalDate: "2026-08-01",
          noticeDeadline: "2026-07-01",
          status: "processed",
          decision: "renewed",
          decisionAt: new Date(),
        })
        .returning();
      if (!event) throw new Error("event seed failed");

      const codes = i === 2 ? ["low_usage"] : ["cost_reduction"];
      await db.insert(decisionContextsTable).values({
        accountId: seeded.accountIds[i]!,
        renewalEventId: event.id,
        rationaleCodesJson: codes,
        negotiationLever: "multi_year_commit",
      });
    }

    const bench = await getVendorBenchmark("DocSign");
    expect(bench).not.toBeNull();
    expect(bench?.topRationaleCodes[0]?.code).toBe("cost_reduction");
    expect(bench?.topRationaleCodes[0]?.count).toBe(2);
    expect(bench?.topLevers[0]?.lever).toBe("multi_year_commit");
  });

  it("medianSavingsAnnualCents computed from actual savings rows", async () => {
    const seeded = await seedSampleAccounts({
      vendorNames: ["Miro"],
      accountCount: 3,
    });
    // Create a renewal event + savings row per subscription.
    for (let i = 0; i < seeded.subscriptionIds.length; i++) {
      const subId = seeded.subscriptionIds[i]!;
      const [event] = await db
        .insert(renewalEventsTable)
        .values({
          accountId: seeded.accountIds[i]!,
          subscriptionId: subId,
          renewalDate: "2026-08-01",
          noticeDeadline: "2026-07-01",
          status: "processed",
          decision: "downgraded",
          decisionAt: new Date(),
        })
        .returning();
      if (!event) throw new Error("event seed failed");
      const saved = [10_000, 20_000, 30_000][i]!;
      await db.insert(savingsRecordsTable).values({
        accountId: seeded.accountIds[i]!,
        renewalEventId: event.id,
        subscriptionId: subId,
        kind: "downgraded",
        baselineAnnualUsdCents: 100_000,
        newAnnualUsdCents: 100_000 - saved,
        savedAnnualUsdCents: saved,
      });
    }
    const bench = await getVendorBenchmark("Miro");
    // Median of {10_000, 20_000, 30_000} = 20_000.
    expect(bench?.medianSavingsAnnualCents).toBe(20_000);
  });
});
