/**
 * Wedge PoC — offline fixture spend dataset.
 *
 * Deterministic: every date derives from a FIXED anchor (no Date.now), so the
 * detector tests can assert exact outputs. Models ~14 months of card spend and
 * exercises every detector branch:
 *
 *   - Notion   — clean monthly flat → monthly, high confidence
 *   - Slack    — monthly with a mid-year price step → drift / price-increase
 *   - Datadog  — monthly, big-ticket, usage wobble → detected, lower confidence
 *   - Zoom     — quarterly
 *   - GitHub   — single annual charge → needsManualConfirm, no projection
 *   - AWS      — irregular cloud one-offs → REJECTED
 *   - Coffee   — small irregular → REJECTED
 *   - Hetzner  — EUR-billed monthly → currency partition
 *   - Webflow  — charge + same-amount refund → REJECTED (refund netting)
 *   - Amazon   — steady $40/mo stream buried in chaotic one-offs → plateau cluster survives
 *   - Linear   — monthly (matches an existing seeded subscription → "match, no draft")
 *
 * GTM note: the fixture is a CI harness + keys-not-yet fallback ONLY. It is
 * forbidden in partner-facing sessions (see strategy doc §3a.1) — partners see
 * their own pre-loaded spend.
 */
import type { SpendConnectorTransaction } from "../types";

/** Fixed anchor — the "most recent" charge date in the dataset. */
const ANCHOR = "2026-05-15";

const MCC_SAAS = "5734"; // computer software stores
const MCC_CLOUD = "7372"; // computer programming / data processing
const MCC_RETAIL = "5999"; // misc retail
const MCC_RESTAURANT = "5812";

/** Calendar arithmetic in UTC; deterministic, no Date.now. */
function addDaysUtc(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

let seq = 0;
function tx(
  merchant: string,
  amountCents: number,
  chargedOn: string,
  opts: { mcc?: string | null; currency?: string; cardLabel?: string } = {}
): SpendConnectorTransaction {
  seq += 1;
  return {
    externalId: `fx_${String(seq).padStart(4, "0")}`,
    rawMerchant: merchant,
    mcc: opts.mcc ?? null,
    amountCents,
    currency: opts.currency ?? "USD",
    chargedOn,
    cardLabel: opts.cardLabel ?? "•••• 4242",
    raw: { source: "fixture", merchant },
  };
}

/** Emit `count` charges stepping BACK from anchor by `stepDays`, newest first
 *  in time but pushed oldest→newest into the list. `amountFor(i)` lets a series
 *  vary its amount (price step, wobble). i=0 is the most recent charge. */
function series(
  merchant: string,
  count: number,
  stepDays: number,
  amountFor: (i: number) => number,
  opts: { mcc?: string | null; currency?: string } = {}
): SpendConnectorTransaction[] {
  const out: SpendConnectorTransaction[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(tx(merchant, amountFor(i), addDaysUtc(ANCHOR, -i * stepDays), opts));
  }
  return out;
}

const txns: SpendConnectorTransaction[] = [];

// Notion — clean monthly flat $80 (14 charges) → monthly, ~95
txns.push(...series("RAMP *NOTION LABS", 14, 30, () => 8000, { mcc: MCC_SAAS }));

// Slack — monthly, $150 for the older 7, $172 for the recent 7 → price step +15%
txns.push(
  ...series("SLACK TECHNOLOGIES", 14, 30, (i) => (i < 7 ? 17200 : 15000), {
    mcc: MCC_SAAS,
  })
);

// Datadog — monthly big-ticket ~$7000 ±8% deterministic wobble → detected, lower conf
const ddWobble = [1.0, 0.94, 1.07, 0.97, 1.03, 0.92, 1.08, 1.0, 0.96, 1.05, 1.01, 0.93];
txns.push(
  ...series("DATADOG INC", 12, 30, (i) => Math.round(700000 * ddWobble[i]!), {
    mcc: MCC_CLOUD,
  })
);

// Zoom — quarterly ~$1500 (5 charges, ~91d apart) → quarterly
txns.push(...series("ZOOM VIDEO COMM", 5, 91, () => 150000, { mcc: MCC_SAAS }));

// GitHub — single annual $21,000 charge, SaaS MCC → needsManualConfirm, annual
txns.push(tx("GITHUB INC", 2_100_000, addDaysUtc(ANCHOR, -40), { mcc: MCC_SAAS }));

// AWS — irregular cloud one-offs (varying amounts, irregular spacing) → REJECTED
txns.push(tx("AMAZON WEB SERVICES", 240_00, addDaysUtc(ANCHOR, -12), { mcc: MCC_CLOUD }));
txns.push(tx("AMAZON WEB SERVICES", 1180_00, addDaysUtc(ANCHOR, -47), { mcc: MCC_CLOUD }));
txns.push(tx("AMAZON WEB SERVICES", 75_00, addDaysUtc(ANCHOR, -96), { mcc: MCC_CLOUD }));
txns.push(tx("AMAZON WEB SERVICES", 612_00, addDaysUtc(ANCHOR, -191), { mcc: MCC_CLOUD }));

// Coffee — small irregular → REJECTED
txns.push(tx("BLUE BOTTLE COFFEE", 18_50, addDaysUtc(ANCHOR, -3), { mcc: MCC_RESTAURANT }));
txns.push(tx("BLUE BOTTLE COFFEE", 22_00, addDaysUtc(ANCHOR, -19), { mcc: MCC_RESTAURANT }));
txns.push(tx("BLUE BOTTLE COFFEE", 9_75, addDaysUtc(ANCHOR, -52), { mcc: MCC_RESTAURANT }));

// Hetzner — EUR monthly €120 (6 charges) → currency partition; detected under EUR
txns.push(...series("HETZNER ONLINE", 6, 30, () => 12000, { mcc: MCC_CLOUD, currency: "EUR" }));

// Webflow — single charge + same-amount refund → REJECTED (refund netting)
txns.push(tx("WEBFLOW INC", 4900, addDaysUtc(ANCHOR, -22), { mcc: MCC_SAAS }));
txns.push(tx("WEBFLOW INC", -4900, addDaysUtc(ANCHOR, -18), { mcc: MCC_SAAS }));

// Amazon — steady $40/mo SaaS stream BURIED in chaotic retail one-offs (same merchant)
//          → amount-plateau cluster must isolate the $40 stream.
txns.push(...series("AMZN MKTP US", 12, 30, () => 4000, { mcc: MCC_RETAIL }));
txns.push(tx("AMZN MKTP US", 7_30, addDaysUtc(ANCHOR, -5), { mcc: MCC_RETAIL }));
txns.push(tx("AMZN MKTP US", 230_00, addDaysUtc(ANCHOR, -33), { mcc: MCC_RETAIL }));
txns.push(tx("AMZN MKTP US", 12_99, addDaysUtc(ANCHOR, -77), { mcc: MCC_RETAIL }));
txns.push(tx("AMZN MKTP US", 89_00, addDaysUtc(ANCHOR, -120), { mcc: MCC_RETAIL }));

// Linear — monthly $96 (matches a seeded existing subscription in tests)
txns.push(...series("LINEAR", 10, 30, () => 9600, { mcc: MCC_SAAS }));

export const FIXTURE_TRANSACTIONS: ReadonlyArray<SpendConnectorTransaction> = txns;
