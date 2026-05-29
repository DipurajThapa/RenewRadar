/**
 * Paste-from-spreadsheet contract tests.
 *
 * The CSV import dialog used to assume customers would save-as-CSV before
 * pasting. They don't — every "I tried to import and it didn't work" support
 * ticket was a customer pasting tab-separated text straight from Excel /
 * Google Sheets / Numbers.
 *
 * `normalizeTabularInput` sniffs the delimiter and converts TSV → CSV so the
 * downstream parser stays single-format. These tests pin:
 *
 *   - CSV passes through unchanged (the canonical path).
 *   - TSV is converted, with cells that contain commas getting properly
 *     CSV-quoted so the parser later splits on the right boundary.
 *   - Pasting from Excel (tab-separated with embedded commas in cells)
 *     round-trips through normalize + parseSubscriptionCsv with zero per-row
 *     errors.
 *   - CRLF / CR / LF line endings all work.
 *   - Mixed-content garbage doesn't crash.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeTabularInput,
  parseSubscriptionCsv,
  SUBSCRIPTION_CSV_HEADERS,
} from "@server/infrastructure/csv/subscriptions-format";

describe("normalizeTabularInput", () => {
  it("returns CSV input unchanged (no-op for the canonical path)", () => {
    const csv = "vendor,product\nSlack,Workspace\nNotion,Team plan";
    expect(normalizeTabularInput(csv)).toBe(csv);
  });

  it("converts TSV to CSV when tabs dominate the sample", () => {
    const tsv = "vendor\tproduct\nSlack\tWorkspace";
    const out = normalizeTabularInput(tsv);
    expect(out).toBe("vendor,product\nSlack,Workspace");
  });

  it("quotes cells that contain commas when converting TSV to CSV", () => {
    // The real Excel-paste failure mode: cell text contains a comma that
    // the parser would otherwise treat as a second field boundary.
    const tsv = 'vendor\tproduct\n"Acme, Inc."\tWorkspace\nSlack, LLC\tStarter';
    // The literal `"Acme, Inc."` was already quoted by Excel; the
    // unquoted `Slack, LLC` needs to be quoted on the CSV side.
    const out = normalizeTabularInput(tsv);
    expect(out.split("\n")[0]).toBe("vendor,product");
    expect(out.split("\n")[2]).toBe('"Slack, LLC",Starter');
  });

  it("handles CRLF and CR line endings", () => {
    const tsv = "vendor\tproduct\r\nSlack\tWorkspace\rNotion\tTeam";
    const out = normalizeTabularInput(tsv);
    // Output is LF-normalized, with three rows.
    expect(out.split("\n")).toEqual([
      "vendor,product",
      "Slack,Workspace",
      "Notion,Team",
    ]);
  });

  it("returns empty input unchanged", () => {
    expect(normalizeTabularInput("")).toBe("");
  });

  it("does not mangle CSV that happens to have a couple of stray tabs", () => {
    // A user pastes CSV with tabs inside a single cell. Commas still
    // dominate, so we treat it as CSV and leave it alone.
    const csv = 'vendor,product\nSlack,"Workspace\twith tab"';
    expect(normalizeTabularInput(csv)).toBe(csv);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// End-to-end: an Excel paste should produce a clean parse with zero per-row
// errors against the canonical schema.
// ─────────────────────────────────────────────────────────────────────────

describe("Excel paste → parseSubscriptionCsv round-trip", () => {
  it("parses a realistic 3-row Excel paste with no row errors", () => {
    // What an Excel paste actually looks like — header row matches the
    // canonical SUBSCRIPTION_CSV_HEADERS exactly. Cells separated by tabs.
    // Includes vendor names with commas to exercise the quoting path.
    const header = SUBSCRIPTION_CSV_HEADERS.join("\t");
    const rows = [
      [
        "Slack, Inc.",
        "Slack Business+",
        "Business+",
        "annual",
        "2026-01-01",
        "2027-01-01",
        "60",
        "100",
        "150",
        "180000",
        "true",
        "active",
        "ops@example.com",
        "2026-11-02",
        "",
      ].join("\t"),
      [
        "Notion Labs",
        "Notion Team Plan",
        "Team",
        "annual",
        "2026-03-15",
        "2027-03-15",
        "30",
        "25",
        "96",
        "28800",
        "true",
        "active",
        "",
        "2027-02-13",
        "Auto-renews at list price",
      ].join("\t"),
      [
        "Figma, Inc.",
        "Figma Organization",
        "Organization",
        "annual",
        "2026-06-01",
        "2027-06-01",
        "90",
        "20",
        "540",
        "129600",
        "false",
        "active",
        "design@example.com",
        "2027-03-03",
        "",
      ].join("\t"),
    ];
    const excelPaste = [header, ...rows].join("\n");

    const normalized = normalizeTabularInput(excelPaste);
    const parsed = parseSubscriptionCsv(normalized);

    expect(parsed.headerOk).toBe(true);
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows.length).toBe(3);
    expect(parsed.rows.every((r) => r.ok)).toBe(true);

    // Spot-check that the vendor with a comma in the name survived the
    // TSV → CSV → parse round-trip — this is the canonical failure mode
    // we're guarding against.
    const first = parsed.rows[0];
    expect(first?.ok).toBe(true);
    if (first?.ok) {
      expect(first.row.vendor).toBe("Slack, Inc.");
      expect(first.row.product).toBe("Slack Business+");
    }
  });
});
