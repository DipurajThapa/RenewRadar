import { describe, expect, it } from "vitest";
import {
  parseSubscriptionCsv,
  rowsToCsv,
  type ExportRow,
} from "@/lib/csv/subscriptions-format";

describe("parseSubscriptionCsv", () => {
  it("rejects a CSV that's missing required columns", () => {
    const csv = "vendor,product\nAcme,Widget";
    const result = parseSubscriptionCsv(csv);
    expect(result.headerOk).toBe(false);
    expect(result.missingColumns).toContain("billing_cycle");
    expect(result.rows).toEqual([]);
  });

  it("parses a clean row end-to-end", () => {
    const csv = [
      "vendor,product,plan,billing_cycle,term_start,term_end,notice_period_days,seats,unit_price_usd,auto_renew,owner_email,notes",
      "Atlassian,Jira,Standard,annual,2026-01-01,2026-12-31,30,10,50.00,true,owner@example.com,A note",
    ].join("\n");
    const result = parseSubscriptionCsv(csv);
    expect(result.headerOk).toBe(true);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]).toEqual({
      ok: true,
      row: {
        vendor: "Atlassian",
        product: "Jira",
        plan: "Standard",
        billing_cycle: "annual",
        term_start: "2026-01-01",
        term_end: "2026-12-31",
        notice_period_days: 30,
        seats: 10,
        unit_price_cents: 5000,
        auto_renew: true,
        status: null,
        owner_email: "owner@example.com",
        notes: "A note",
      },
    });
  });

  it("collects per-row validation errors without aborting the whole batch", () => {
    const csv = [
      "vendor,product,plan,billing_cycle,term_start,term_end,notice_period_days,seats,unit_price_usd,auto_renew",
      // Row 1: bad billing_cycle, end before start, negative seats
      "Acme,Widget,,bad,2026-12-31,2026-01-01,-5,0,50,true",
      // Row 2: clean
      "Beta,Tool,,monthly,2026-01-01,2026-06-30,14,5,12.50,false",
    ].join("\n");
    const result = parseSubscriptionCsv(csv);
    expect(result.headerOk).toBe(true);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]?.ok).toBe(false);
    if (!result.rows[0]?.ok) {
      // Multiple errors collected on one row
      expect(result.rows[0]!.errors.length).toBeGreaterThanOrEqual(3);
    }
    expect(result.rows[1]?.ok).toBe(true);
  });

  it("survives quoted cells containing commas and embedded quotes", () => {
    const csv = [
      "vendor,product,plan,billing_cycle,term_start,term_end,notice_period_days,seats,unit_price_usd,auto_renew,notes",
      `"Acme, Inc.","Widget ""Pro""",,annual,2026-01-01,2026-12-31,30,10,50.00,true,"line one\nline two"`,
    ].join("\n");
    const result = parseSubscriptionCsv(csv);
    expect(result.headerOk).toBe(true);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.ok).toBe(true);
    if (result.rows[0]?.ok) {
      expect(result.rows[0].row.vendor).toBe("Acme, Inc.");
      expect(result.rows[0].row.product).toBe('Widget "Pro"');
      expect(result.rows[0].row.notes).toBe("line one\nline two");
    }
  });

  it("accepts auto_renew in multiple truthy/falsy spellings", () => {
    const csv = [
      "vendor,product,billing_cycle,term_start,term_end,notice_period_days,seats,unit_price_usd,auto_renew",
      "A,P,annual,2026-01-01,2026-12-31,30,1,1,yes",
      "B,P,annual,2026-01-01,2026-12-31,30,1,1,no",
      "C,P,annual,2026-01-01,2026-12-31,30,1,1,1",
      "D,P,annual,2026-01-01,2026-12-31,30,1,1,0",
      "E,P,annual,2026-01-01,2026-12-31,30,1,1,",
    ].join("\n");
    const result = parseSubscriptionCsv(csv);
    expect(result.headerOk).toBe(true);
    expect(result.rows.length).toBe(5);
    const flags = result.rows.map((r) =>
      r.ok ? r.row.auto_renew : "error"
    );
    expect(flags).toEqual([true, false, true, false, false]);
  });

  it("round-trips export → parse losslessly for in-schema fields", () => {
    const row: ExportRow = {
      vendorName: "Round, Trip",
      productName: 'has "quotes"',
      planName: "Pro",
      billingCycle: "annual",
      termStartDate: "2026-03-01",
      termEndDate: "2027-02-28",
      noticePeriodDays: 60,
      totalSeats: 25,
      unitPriceCents: 8_750, // $87.50
      totalCostPerPeriodCents: 25 * 8_750,
      autoRenew: true,
      status: "active",
      ownerEmail: "x@y.test",
      notes: "newline\nin notes",
    };
    const csv = rowsToCsv([row]);
    const parsed = parseSubscriptionCsv(csv);
    expect(parsed.headerOk).toBe(true);
    expect(parsed.rows[0]?.ok).toBe(true);
    if (parsed.rows[0]?.ok) {
      const r = parsed.rows[0].row;
      expect(r.vendor).toBe("Round, Trip");
      expect(r.product).toBe('has "quotes"');
      expect(r.plan).toBe("Pro");
      expect(r.billing_cycle).toBe("annual");
      expect(r.term_start).toBe("2026-03-01");
      expect(r.term_end).toBe("2027-02-28");
      expect(r.notice_period_days).toBe(60);
      expect(r.seats).toBe(25);
      expect(r.unit_price_cents).toBe(8_750);
      expect(r.auto_renew).toBe(true);
      expect(r.owner_email).toBe("x@y.test");
      expect(r.notes).toBe("newline\nin notes");
    }
  });
});
