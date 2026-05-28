/**
 * Canonical column contract for subscription CSV import & export.
 *
 * The same column names + order are used by both directions so a round-trip
 * (export → edit → re-import) is loss-free. If you change this list:
 *   1. Update SUBSCRIPTION_CSV_HEADERS below.
 *   2. Update parseSubscriptionCsvRow.
 *   3. Update the user-facing schema doc in the import dialog.
 *   4. The export action picks the order up automatically.
 */

import { calculateNoticeDeadline } from "@server/domain/notice-deadline/calculate";
import { annualizeCents } from "@server/domain/billing/annualize";

export const SUBSCRIPTION_CSV_HEADERS = [
  "vendor",
  "product",
  "plan",
  "billing_cycle",
  "term_start",
  "term_end",
  "notice_period_days",
  "seats",
  "unit_price_usd",
  "annualized_usd",
  "auto_renew",
  "status",
  "owner_email",
  "notice_deadline",
  "notes",
] as const;

export type SubscriptionCsvHeader = (typeof SUBSCRIPTION_CSV_HEADERS)[number];

export type ExportRow = {
  vendorName: string;
  productName: string;
  planName: string | null;
  billingCycle: string;
  termStartDate: string;
  termEndDate: string;
  noticePeriodDays: number;
  totalSeats: number;
  unitPriceCents: number;
  totalCostPerPeriodCents: number;
  autoRenew: boolean;
  status: string;
  ownerEmail: string | null;
  notes: string | null;
};

/**
 * Serialize an array of rows to a CSV string.
 *
 * Hand-rolled — papaparse handles fancy edge cases but adds 30kb. Our schema
 * is fixed and small. The cost of a custom serializer is one helper. Be sure
 * to escape any double-quotes and newlines per RFC 4180 (handled here).
 */
export function rowsToCsv(rows: ExportRow[]): string {
  const lines: string[] = [];
  lines.push(SUBSCRIPTION_CSV_HEADERS.join(","));

  for (const row of rows) {
    const noticeDeadline = calculateNoticeDeadline(
      row.termEndDate,
      row.noticePeriodDays
    )
      .toISOString()
      .split("T")[0]!;
    const annualUsd =
      annualizeCents(row.totalCostPerPeriodCents, row.billingCycle) / 100;

    const cells: Record<SubscriptionCsvHeader, string> = {
      vendor: row.vendorName,
      product: row.productName,
      plan: row.planName ?? "",
      billing_cycle: row.billingCycle,
      term_start: row.termStartDate,
      term_end: row.termEndDate,
      notice_period_days: String(row.noticePeriodDays),
      seats: String(row.totalSeats),
      unit_price_usd: (row.unitPriceCents / 100).toFixed(2),
      annualized_usd: annualUsd.toFixed(2),
      auto_renew: row.autoRenew ? "true" : "false",
      status: row.status,
      owner_email: row.ownerEmail ?? "",
      notice_deadline: noticeDeadline,
      notes: row.notes ?? "",
    };

    lines.push(
      SUBSCRIPTION_CSV_HEADERS.map((h) => escapeCsvCell(cells[h])).join(",")
    );
  }

  return lines.join("\n") + "\n";
}

// ─── Parsing ────────────────────────────────────────────────────────────────

export type ParsedRow = {
  vendor: string;
  product: string;
  plan: string | null;
  billing_cycle: string;
  term_start: string;
  term_end: string;
  notice_period_days: number;
  seats: number;
  unit_price_cents: number;
  auto_renew: boolean;
  status: string | null;
  owner_email: string | null;
  notes: string | null;
};

export type RowParseResult =
  | { ok: true; row: ParsedRow }
  | { ok: false; errors: string[] };

/**
 * Parse a CSV string into a list of typed rows + per-row parse results.
 *
 * Hand-rolled — papaparse is overkill for our fixed schema and adds a chunky
 * dep just for one feature. We handle RFC 4180 quoting + escaping inline.
 *
 * Unknown columns are tolerated and ignored. Missing required columns produce
 * a top-level error (the header check fails before any row is parsed).
 *
 * Per-row errors do NOT abort the whole import — the caller decides whether
 * to skip-and-continue or reject-all.
 */
export function parseSubscriptionCsv(
  text: string
): {
  /** True if the header row contained every required column. */
  headerOk: boolean;
  /** Missing required column names (empty when headerOk is true). */
  missingColumns: string[];
  /** Per-row results, in source order. Empty when headerOk is false. */
  rows: RowParseResult[];
} {
  const lines = splitCsvLines(text);
  if (lines.length === 0) {
    return { headerOk: false, missingColumns: [...SUBSCRIPTION_CSV_HEADERS], rows: [] };
  }

  const headerCells = parseCsvLine(lines[0]!).map((c) => c.trim().toLowerCase());
  const headerIndex = new Map<string, number>();
  headerCells.forEach((h, i) => headerIndex.set(h, i));

  // Required columns: everything except plan/owner_email/notes/annualized_usd/notice_deadline/status
  const REQUIRED: SubscriptionCsvHeader[] = [
    "vendor",
    "product",
    "billing_cycle",
    "term_start",
    "term_end",
    "notice_period_days",
    "seats",
    "unit_price_usd",
    "auto_renew",
  ];
  const missing = REQUIRED.filter((c) => !headerIndex.has(c));
  if (missing.length > 0) {
    return { headerOk: false, missingColumns: missing, rows: [] };
  }

  const rows: RowParseResult[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const cells = parseCsvLine(raw);
    const cellAt = (h: SubscriptionCsvHeader): string => {
      const idx = headerIndex.get(h);
      if (idx === undefined) return "";
      return (cells[idx] ?? "").trim();
    };

    const errors: string[] = [];

    const vendor = cellAt("vendor");
    if (!vendor) errors.push("vendor is required");

    const product = cellAt("product");
    if (!product) errors.push("product is required");

    const billing_cycle = cellAt("billing_cycle").toLowerCase();
    if (!["monthly", "quarterly", "annual", "multi_year"].includes(billing_cycle)) {
      errors.push("billing_cycle must be one of: monthly, quarterly, annual, multi_year");
    }

    const term_start = cellAt("term_start");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(term_start)) {
      errors.push("term_start must be YYYY-MM-DD");
    }
    const term_end = cellAt("term_end");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(term_end)) {
      errors.push("term_end must be YYYY-MM-DD");
    }
    if (term_start && term_end && new Date(term_end) <= new Date(term_start)) {
      errors.push("term_end must be after term_start");
    }

    const notice_period_days = Number(cellAt("notice_period_days"));
    if (
      !Number.isFinite(notice_period_days) ||
      notice_period_days < 0 ||
      notice_period_days > 365
    ) {
      errors.push("notice_period_days must be 0–365");
    }

    const seats = Number(cellAt("seats"));
    if (!Number.isFinite(seats) || !Number.isInteger(seats) || seats < 1) {
      errors.push("seats must be a positive integer");
    }

    const unit_price_dollars = Number(cellAt("unit_price_usd"));
    if (!Number.isFinite(unit_price_dollars) || unit_price_dollars < 0) {
      errors.push("unit_price_usd must be a non-negative number");
    }
    const unit_price_cents = Math.round(unit_price_dollars * 100);

    const autoRenewRaw = cellAt("auto_renew").toLowerCase();
    let auto_renew: boolean;
    if (autoRenewRaw === "true" || autoRenewRaw === "yes" || autoRenewRaw === "1") {
      auto_renew = true;
    } else if (
      autoRenewRaw === "false" ||
      autoRenewRaw === "no" ||
      autoRenewRaw === "0" ||
      autoRenewRaw === ""
    ) {
      auto_renew = false;
    } else {
      auto_renew = false;
      errors.push("auto_renew must be true/false (or yes/no, 1/0)");
    }

    const plan = cellAt("plan") || null;
    const status = cellAt("status") || null;
    const owner_email = cellAt("owner_email") || null;
    const notes = cellAt("notes") || null;

    if (errors.length > 0) {
      rows.push({ ok: false, errors });
    } else {
      rows.push({
        ok: true,
        row: {
          vendor,
          product,
          plan,
          billing_cycle,
          term_start,
          term_end,
          notice_period_days,
          seats,
          unit_price_cents,
          auto_renew,
          status,
          owner_email,
          notes,
        },
      });
    }
  }

  return { headerOk: true, missingColumns: [], rows };
}

/**
 * Split a CSV blob into logical lines, respecting quoted fields that may
 * contain embedded newlines per RFC 4180.
 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      // A doubled quote stays inside; we'll handle the unescape in parseCsvLine.
      buf += ch;
      if (inQuotes && text[i + 1] === '"') {
        buf += text[++i]!;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) lines.push(buf);
  return lines;
}

/**
 * Parse one CSV line into its cells, handling RFC 4180 quoting.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === ",") {
      cells.push(buf);
      buf = "";
      continue;
    }
    if (ch === '"' && buf === "") {
      inQuotes = true;
      continue;
    }
    buf += ch;
  }
  cells.push(buf);
  return cells;
}

function escapeCsvCell(value: string): string {
  if (value === "") return "";
  // RFC 4180: any cell containing a comma, double-quote, CR, or LF must be
  // double-quoted; embedded double-quotes are doubled.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
