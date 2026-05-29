/**
 * Sample CSV download — the "show me what to fill in" path.
 *
 * The CSV importer accepts 15 columns and a strict format. Customers who
 * land on the import dialog cold need a working example to copy. This route
 * returns a 3-row file with realistic values:
 *
 *   1. Slack Business+ — large vendor, comma in the legal name to exercise
 *      RFC 4180 quoting in any roundtrip
 *   2. Notion Team Plan — minimal seat count, late renewal
 *   3. Figma Organization — auto-renew off, a notes field with text
 *
 * The file is generated from the canonical `SUBSCRIPTION_CSV_HEADERS`
 * constant + `rowsToCsv` helper, so any future schema change is reflected
 * here automatically — there is no parallel template to maintain.
 *
 * No auth needed: the file is a static template containing no customer
 * data. We deliberately do NOT include real customer rows so it can be
 * shared in marketing pages and help-center articles without risk.
 */
import { rowsToCsv } from "@server/infrastructure/csv/subscriptions-format";
import type { ExportRow } from "@server/infrastructure/csv/subscriptions-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anchor dates on first-of-year so the sample reads naturally for any
// future reader. Using a near-future year keeps "term_end" feeling current
// without baking in a specific quarter the file was generated in.
const SAMPLE_ROWS: ExportRow[] = [
  {
    vendorName: "Slack, Inc.",
    productName: "Slack Business+",
    planName: "Business+",
    billingCycle: "annual",
    termStartDate: "2026-01-01",
    termEndDate: "2027-01-01",
    noticePeriodDays: 60,
    totalSeats: 100,
    unitPriceCents: 15_000, // $150 per seat / year
    totalCostPerPeriodCents: 1_500_000,
    autoRenew: true,
    status: "active",
    ownerEmail: "ops@example.com",
    notes: null,
  },
  {
    vendorName: "Notion Labs",
    productName: "Notion Team Plan",
    planName: "Team",
    billingCycle: "annual",
    termStartDate: "2026-03-15",
    termEndDate: "2027-03-15",
    noticePeriodDays: 30,
    totalSeats: 25,
    unitPriceCents: 9_600, // $96 per seat / year
    totalCostPerPeriodCents: 240_000,
    autoRenew: true,
    status: "active",
    ownerEmail: null,
    notes: null,
  },
  {
    vendorName: "Figma, Inc.",
    productName: "Figma Organization",
    planName: "Organization",
    billingCycle: "annual",
    termStartDate: "2026-06-01",
    termEndDate: "2027-06-01",
    noticePeriodDays: 90,
    totalSeats: 20,
    unitPriceCents: 54_000, // $540 per seat / year
    totalCostPerPeriodCents: 1_080_000,
    autoRenew: false,
    status: "active",
    ownerEmail: "design@example.com",
    notes: "Renegotiated 2025 — 90-day notice required by contract.",
  },
];

export function GET() {
  const csv = rowsToCsv(SAMPLE_ROWS);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="renewal-radar-sample.csv"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
