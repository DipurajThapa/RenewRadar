import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_CSV_HEADERS,
  rowsToCsv,
  type ExportRow,
} from "@/lib/csv/subscriptions-format";

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    vendorName: "Atlassian",
    productName: "Jira Software",
    planName: "Standard",
    billingCycle: "annual",
    termStartDate: "2026-01-01",
    termEndDate: "2026-12-31",
    noticePeriodDays: 30,
    totalSeats: 10,
    unitPriceCents: 5_000,
    totalCostPerPeriodCents: 50_000,
    autoRenew: true,
    status: "active",
    ownerEmail: "owner@example.com",
    notes: null,
    ...overrides,
  };
}

describe("rowsToCsv", () => {
  it("emits a header row matching SUBSCRIPTION_CSV_HEADERS exactly", () => {
    const csv = rowsToCsv([]);
    expect(csv.trim()).toBe(SUBSCRIPTION_CSV_HEADERS.join(","));
  });

  it("serializes a single row with the correct number of cells", () => {
    const csv = rowsToCsv([makeRow()]);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(2);
    const cells = lines[1]!.split(",");
    expect(cells.length).toBe(SUBSCRIPTION_CSV_HEADERS.length);
  });

  it("computes notice_deadline as term_end minus notice_period_days", () => {
    const csv = rowsToCsv([
      makeRow({ termEndDate: "2026-12-31", noticePeriodDays: 30 }),
    ]);
    const lines = csv.trim().split("\n");
    const cells = lines[1]!.split(",");
    const noticeIdx = SUBSCRIPTION_CSV_HEADERS.indexOf("notice_deadline");
    expect(cells[noticeIdx]).toBe("2026-12-01");
  });

  it("annualizes monthly billing × 12", () => {
    const csv = rowsToCsv([
      makeRow({
        billingCycle: "monthly",
        totalCostPerPeriodCents: 5_000, // $50/mo
      }),
    ]);
    const lines = csv.trim().split("\n");
    const cells = lines[1]!.split(",");
    const idx = SUBSCRIPTION_CSV_HEADERS.indexOf("annualized_usd");
    expect(cells[idx]).toBe("600.00");
  });

  it("escapes commas and double-quotes per RFC 4180", () => {
    const csv = rowsToCsv([
      makeRow({
        productName: "Jira, Software",
        notes: 'has "quotes" in it',
      }),
    ]);
    const lines = csv.trim().split("\n");
    // The product cell should be wrapped in double-quotes because of the comma.
    expect(lines[1]).toContain('"Jira, Software"');
    // The notes cell should have embedded quotes doubled.
    expect(lines[1]).toContain('"has ""quotes"" in it"');
  });

  it("emits owner_email and plan as empty strings when null", () => {
    const csv = rowsToCsv([
      makeRow({ planName: null, ownerEmail: null, notes: null }),
    ]);
    const lines = csv.trim().split("\n");
    const cells = lines[1]!.split(",");
    const planIdx = SUBSCRIPTION_CSV_HEADERS.indexOf("plan");
    const ownerIdx = SUBSCRIPTION_CSV_HEADERS.indexOf("owner_email");
    const notesIdx = SUBSCRIPTION_CSV_HEADERS.indexOf("notes");
    expect(cells[planIdx]).toBe("");
    expect(cells[ownerIdx]).toBe("");
    expect(cells[notesIdx]).toBe("");
  });

  it("encodes auto_renew as 'true' / 'false'", () => {
    const csv = rowsToCsv([
      makeRow({ autoRenew: true }),
      makeRow({ autoRenew: false }),
    ]);
    const lines = csv.trim().split("\n");
    const autoIdx = SUBSCRIPTION_CSV_HEADERS.indexOf("auto_renew");
    expect(lines[1]!.split(",")[autoIdx]).toBe("true");
    expect(lines[2]!.split(",")[autoIdx]).toBe("false");
  });
});
