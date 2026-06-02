/**
 * Pure detector tests — no DB. Feeds the fixture through the canonical
 * normalization (spendMerchantKey) then the detector, and asserts every
 * branch: monthly, price-step drift, quarterly, single-charge annual,
 * wobble (lower conf), one-off rejection, currency partition, refund netting,
 * and the amount-plateau survival inside a noisy bucket.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_TRANSACTIONS } from "@server/infrastructure/spend/fixtures/dataset";
import { spendMerchantKey } from "@server/domain/spend/normalize";
import {
  detectRecurringCharges,
  type DetectorTransaction,
} from "@server/domain/spend/detect-recurring";

const rows: DetectorTransaction[] = FIXTURE_TRANSACTIONS.map((t) => ({
  normalizedMerchant: spendMerchantKey(t.rawMerchant),
  currency: t.currency,
  amountCents: t.amountCents,
  chargedOn: t.chargedOn,
  mcc: t.mcc,
}));

const result = detectRecurringCharges(rows);
const byMerchant = (m: string) =>
  result.find((c) => c.normalizedMerchant === spendMerchantKey(m));

describe("detectRecurringCharges — fixture", () => {
  it("detects Notion as clean monthly with high confidence", () => {
    const notion = byMerchant("NOTION LABS");
    expect(notion).toBeTruthy();
    expect(notion!.detectedCycle).toBe("monthly");
    expect(notion!.confidence).toBeGreaterThanOrEqual(90);
    expect(notion!.typicalAmountCents).toBe(8000);
    expect(notion!.projectedNextChargeOn).toBeTruthy();
    expect(Number.isInteger(notion!.confidence)).toBe(true);
  });

  it("detects Slack monthly with a positive price-increase drift, still confident", () => {
    const slack = byMerchant("SLACK TECHNOLOGIES");
    expect(slack).toBeTruthy();
    expect(slack!.detectedCycle).toBe("monthly");
    expect(slack!.amountDriftPct).toBeGreaterThanOrEqual(12); // 150 → 172 ≈ +15%
    expect(slack!.latestAmountCents).toBe(17200);
    // a clean step must NOT be penalized as wobble
    expect(slack!.confidence).toBeGreaterThanOrEqual(90);
  });

  it("detects Datadog monthly but with LOWER confidence than Notion (usage wobble)", () => {
    const dd = byMerchant("DATADOG INC");
    const notion = byMerchant("NOTION LABS");
    expect(dd).toBeTruthy();
    expect(dd!.detectedCycle).toBe("monthly");
    expect(dd!.confidence).toBeLessThan(notion!.confidence);
  });

  it("does NOT report a phantom price-drift for Datadog's wobbly flat charges", () => {
    // The pre-fix endpoint comparison reported +8% drift on Datadog from pure
    // ±8% usage noise — a phantom price-increase alert on a flat subscription.
    // The trend-based comparison (first-third median vs last-third median)
    // neutralizes wobble; any residual drift must stay well within the noise
    // floor of a clearly-flat series.
    const dd = byMerchant("DATADOG INC");
    expect(dd).toBeTruthy();
    expect(Math.abs(dd!.amountDriftPct)).toBeLessThan(3);
  });

  it("detects Zoom as quarterly", () => {
    const zoom = byMerchant("ZOOM VIDEO COMM");
    expect(zoom).toBeTruthy();
    expect(zoom!.detectedCycle).toBe("quarterly");
  });

  it("flags GitHub single annual charge for manual confirm, no projection, conf<=40 → rejected by floor", () => {
    // single-charge annual gets confidence 40 which is BELOW MIN_DETECTION_CONFIDENCE (50)
    // → it should NOT appear in the confident result set. This is the conservative bias.
    const gh = byMerchant("GITHUB INC");
    expect(gh).toBeUndefined();
  });

  it("rejects AWS irregular one-offs", () => {
    expect(byMerchant("AMAZON WEB SERVICES")).toBeUndefined();
  });

  it("rejects coffee", () => {
    expect(byMerchant("BLUE BOTTLE COFFEE")).toBeUndefined();
  });

  it("partitions currency: Hetzner detected under EUR", () => {
    const hetzner = byMerchant("HETZNER ONLINE");
    expect(hetzner).toBeTruthy();
    expect(hetzner!.currency).toBe("EUR");
    expect(hetzner!.detectedCycle).toBe("monthly");
  });

  it("nets a charge+refund pair to nothing (Webflow rejected)", () => {
    expect(byMerchant("WEBFLOW INC")).toBeUndefined();
  });

  it("isolates the steady $40/mo Amazon stream from chaotic one-offs", () => {
    const amzn = byMerchant("AMZN MKTP US");
    expect(amzn).toBeTruthy();
    expect(amzn!.detectedCycle).toBe("monthly");
    expect(amzn!.typicalAmountCents).toBe(4000);
    expect(amzn!.sampleSize).toBe(12);
  });

  it("detects Linear monthly (will match a seeded existing subscription)", () => {
    const linear = byMerchant("LINEAR");
    expect(linear).toBeTruthy();
    expect(linear!.detectedCycle).toBe("monthly");
  });

  it("every candidate clears the confidence floor and has integer confidence", () => {
    for (const c of result) {
      expect(c.confidence).toBeGreaterThanOrEqual(50);
      expect(Number.isInteger(c.confidence)).toBe(true);
      expect(c.suggestedVendorName.length).toBeGreaterThan(0);
    }
  });
});

// ── EDGE-1: dedup on the persistence scope ────────────────────────────────────
// The persistence layer keys a `detected` row on
// (connectionId, normalizedMerchant, currency, detectedCycle). The detector must
// never emit two candidates that share that scope, or the second silently
// clobbers the first on upsert (data loss). It also must NOT over-collapse —
// candidates that differ by cycle or currency are distinct subscriptions.
describe("detectRecurringCharges — dedup on persistence scope (EDGE-1)", () => {
  // calendar-month-spaced stream (monthly: stepMonths=1, quarterly: stepMonths=3)
  function stream(opts: {
    merchant: string;
    amountCents: number;
    count: number;
    startIso: string;
    stepMonths?: number;
    currency?: string;
  }): DetectorTransaction[] {
    const { merchant, amountCents, count, startIso } = opts;
    const stepMonths = opts.stepMonths ?? 1;
    const currency = opts.currency ?? "USD";
    const [y, m, d] = startIso.split("-").map(Number);
    const out: DetectorTransaction[] = [];
    for (let i = 0; i < count; i++) {
      const dt = new Date(Date.UTC(y!, m! - 1 + i * stepMonths, d!));
      out.push({
        normalizedMerchant: spendMerchantKey(merchant),
        currency,
        amountCents,
        chargedOn: dt.toISOString().slice(0, 10),
        mcc: "5734",
      });
    }
    return out;
  }

  it("collapses two same-cycle amount plateaus for one merchant into exactly one candidate", () => {
    // $40/mo and $400/mo streams: clusterByAmount splits them (10x gap), both
    // monthly → same (merchant, USD, monthly) scope → MUST collapse to one.
    const txns = [
      ...stream({ merchant: "DUPCO", amountCents: 4_000, count: 12, startIso: "2026-01-05" }),
      ...stream({ merchant: "DUPCO", amountCents: 40_000, count: 12, startIso: "2026-01-20" }),
    ];
    const out = detectRecurringCharges(txns).filter(
      (c) => c.normalizedMerchant === spendMerchantKey("DUPCO")
    );
    expect(out).toHaveLength(1);
    // deterministic survivor: equal confidence → larger amount wins the tiebreak
    expect(out[0]!.typicalAmountCents).toBe(40_000);
    expect(out[0]!.detectedCycle).toBe("monthly");
  });

  it("does NOT collapse candidates that differ by cycle", () => {
    const txns = [
      ...stream({ merchant: "MULTICO", amountCents: 5_000, count: 12, startIso: "2026-01-05" }),
      ...stream({ merchant: "MULTICO", amountCents: 60_000, count: 5, startIso: "2026-01-15", stepMonths: 3 }),
    ];
    const out = detectRecurringCharges(txns).filter(
      (c) => c.normalizedMerchant === spendMerchantKey("MULTICO")
    );
    expect(out).toHaveLength(2);
    expect(new Set(out.map((c) => c.detectedCycle))).toEqual(
      new Set(["monthly", "quarterly"])
    );
  });

  it("does NOT collapse candidates that differ only by currency (both persist)", () => {
    const txns = [
      ...stream({ merchant: "FXCO", amountCents: 5_000, count: 12, startIso: "2026-01-05", currency: "USD" }),
      ...stream({ merchant: "FXCO", amountCents: 5_000, count: 12, startIso: "2026-01-20", currency: "EUR" }),
    ];
    const out = detectRecurringCharges(txns).filter(
      (c) => c.normalizedMerchant === spendMerchantKey("FXCO")
    );
    expect(out).toHaveLength(2);
    expect(new Set(out.map((c) => c.currency))).toEqual(new Set(["USD", "EUR"]));
  });
});

// ── EDGE-3 / EDGE-5: detection-accuracy polish ────────────────────────────────
describe("detectRecurringCharges — accuracy polish (EDGE-3, EDGE-5)", () => {
  function addDays(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }
  function charge(merchant: string, amountCents: number, iso: string): DetectorTransaction {
    return {
      normalizedMerchant: spendMerchantKey(merchant),
      currency: "USD",
      amountCents,
      chargedOn: iso,
      mcc: "5734",
    };
  }

  it("EDGE-3: a 35/36-day monthly stream still classifies monthly (unrounded median)", () => {
    // gaps 35,36,35,36 → raw median 35.5. Old code rounded to 36 and rejected
    // it (>35); the unrounded median + widened 37 bound keeps it monthly.
    const start = "2026-01-01";
    const days = [0, 35, 71, 106, 142];
    const txns = days.map((g) => charge("BORDERLINE", 5_000, addDays(start, g)));
    const out = detectRecurringCharges(txns).filter(
      (c) => c.normalizedMerchant === spendMerchantKey("BORDERLINE")
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.detectedCycle).toBe("monthly");
  });

  it("EDGE-5: a refund nets the one-off, leaving the recurring stream clean", () => {
    // 6 clean monthly $50 charges + a $50 one-off at day 100 + a $50 refund at
    // day 122 (just 2 days after the day-120 member, 22 after the one-off).
    // Date-only netting would consume the NEAREST = the day-120 member, leaving
    // the irregular one-off in the stream → CV spikes → confidence < floor →
    // REJECTED. Cadence-aware netting consumes the one-off → clean 6-member
    // monthly stream survives with high confidence.
    const start = "2026-01-01";
    const monthly = [0, 30, 60, 90, 120, 150].map((g) =>
      charge("STREAMCO", 5_000, addDays(start, g))
    );
    const oneOff = charge("STREAMCO", 5_000, addDays(start, 100));
    const refund = charge("STREAMCO", -5_000, addDays(start, 122));
    const out = detectRecurringCharges([...monthly, oneOff, refund]).filter(
      (c) => c.normalizedMerchant === spendMerchantKey("STREAMCO")
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.detectedCycle).toBe("monthly");
    expect(out[0]!.sampleSize).toBe(6); // all 6 members survived; one-off netted
    expect(out[0]!.confidence).toBeGreaterThanOrEqual(80);
  });
});
