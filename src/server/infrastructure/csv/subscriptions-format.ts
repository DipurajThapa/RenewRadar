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

  // Multi-language column aliases (T3.8). The header is matched
  // case-insensitively against the canonical English names AND a small
  // set of common DE/FR/ES/JA/PT aliases. The match map is constructed
  // once on first call.
  const headerCells = parseCsvLine(lines[0]!).map((c) =>
    canonicalizeHeaderCell(c)
  );
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
    } else if (!isRealCalendarDate(term_start)) {
      // Regex-only acceptance let "2026-02-30" through — `new Date()` rolled it
      // to Mar 2 silently, the preview marked the row "will create", and the
      // insert later failed with a raw Postgres "date/time field value out of
      // range." Catch the impossible date at preview so the user sees a clean
      // validation message instead of a driver error at commit.
      errors.push("term_start is not a real calendar date");
    }
    const term_end = cellAt("term_end");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(term_end)) {
      errors.push("term_end must be YYYY-MM-DD");
    } else if (!isRealCalendarDate(term_end)) {
      errors.push("term_end is not a real calendar date");
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

    const unit_price_raw = cellAt("unit_price_usd");
    const unit_price_dollars = Number(unit_price_raw);
    if (unit_price_raw === "") {
      // Empty / whitespace-only cell used to coerce to Number("")===0 and
      // silently import a $0/period subscription — a real-world mispricing
      // dressed up as a free plan. Require an explicit number.
      errors.push("unit_price_usd is required");
    } else if (!Number.isFinite(unit_price_dollars) || unit_price_dollars < 0) {
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

// ─────────────────────────────────────────────────────────────────────────
// T3.8 — Multi-language header aliases.
//
// The canonical schema (vendor/product/billing_cycle/…) is English. The
// import is expected to work for finance teams whose templates use a
// different language. We accept common aliases for the languages most
// likely to appear in enterprise sales — German, French, Spanish,
// Japanese, Portuguese — without adding a full i18n stack.
//
// Match rules:
//   - Case-insensitive
//   - Diacritics-insensitive ("période" matches "periode")
//   - Whitespace + underscore + hyphen are interchangeable (so "Term Start",
//     "term-start", and "term_start" all canonicalize the same way)
//
// Adding more aliases is cheap — the cost is one Map lookup per cell. The
// alias map is small enough to keep readable in source rather than loaded
// from JSON.
// ─────────────────────────────────────────────────────────────────────────
const HEADER_ALIASES: Record<SubscriptionCsvHeader, readonly string[]> = {
  vendor: [
    // DE
    "lieferant",
    "anbieter",
    "verkaufer",
    // FR
    "fournisseur",
    "vendeur",
    // ES
    "proveedor",
    "vendedor",
    // PT
    "fornecedor",
    // JA — vendor
    "ベンダー",
    "取引先",
    "サプライヤー",
  ],
  product: [
    "produkt", // DE
    "produit", // FR
    "producto", // ES
    "produto", // PT
    "製品", // JA
    "プロダクト",
  ],
  plan: [
    "tarif", // DE/FR
    "plano", // PT
    "プラン", // JA
  ],
  billing_cycle: [
    "abrechnungszyklus", // DE
    "cycle de facturation", // FR
    "ciclo de facturacion", // ES
    "ciclo de facturação", // PT
    "請求サイクル", // JA
    "billing cycle",
    "billing period",
  ],
  term_start: [
    "vertragsbeginn", // DE
    "debut du contrat", // FR
    "inicio del contrato", // ES
    "inicio do contrato", // PT
    "契約開始日", // JA
    "start date",
    "term start",
    "contract start",
  ],
  term_end: [
    "vertragsende", // DE
    "fin du contrat", // FR
    "fin del contrato", // ES
    "fim do contrato", // PT
    "契約終了日", // JA
    "end date",
    "term end",
    "contract end",
  ],
  notice_period_days: [
    "kundigungsfrist", // DE
    "preavis", // FR
    "preaviso", // ES/PT
    "通知期間", // JA
    "notice period",
    "notice days",
  ],
  seats: [
    "platze", // DE
    "sieges", // FR
    "asientos", // ES
    "assentos", // PT
    "ライセンス数", // JA
    "licenses",
    "users",
  ],
  unit_price_usd: [
    "stuckpreis", // DE
    "prix unitaire", // FR
    "precio unitario", // ES/PT
    "単価", // JA
    "unit price",
    "price per seat",
  ],
  annualized_usd: [
    "jahreskosten", // DE
    "cout annuel", // FR
    "costo anual", // ES
    "custo anual", // PT
    "年額", // JA
    "annual cost",
  ],
  auto_renew: [
    "automatische verlangerung", // DE
    "renouvellement automatique", // FR
    "renovacion automatica", // ES
    "renovacao automatica", // PT
    "自動更新", // JA
    "autorenewal",
  ],
  status: [
    "zustand", // DE
    "etat", // FR
    "estado", // ES/PT
    "ステータス", // JA
  ],
  owner_email: [
    "verantwortlicher", // DE
    "responsable", // FR/ES
    "responsavel", // PT
    "担当者メール", // JA
    "owner",
    "owner email",
  ],
  notice_deadline: [
    "kundigungstermin", // DE
    "date limite preavis", // FR
    "fecha limite de preaviso", // ES
    "data limite do preaviso", // PT
    "通知期限", // JA
  ],
  notes: [
    "anmerkungen", // DE
    "remarques", // FR
    "notas", // ES/PT
    "備考", // JA
    "comments",
    "comment",
  ],
};

/**
 * Build a Map from any-alias → canonical column name. Computed once at
 * module load; the parser uses it in a tight loop.
 */
const HEADER_ALIAS_TO_CANONICAL = (() => {
  const out = new Map<string, SubscriptionCsvHeader>();
  for (const canonical of SUBSCRIPTION_CSV_HEADERS) {
    out.set(normalizeHeaderKey(canonical), canonical);
    for (const alias of HEADER_ALIASES[canonical]) {
      out.set(normalizeHeaderKey(alias), canonical);
    }
  }
  return out;
})();

/**
 * Apply the alias lookup to a raw header cell and return its canonical
 * column name — or the normalized key as a fallback so unknown columns
 * pass through unchanged (they'll be ignored downstream rather than
 * causing a header-mismatch error).
 */
function canonicalizeHeaderCell(rawCell: string): string {
  const key = normalizeHeaderKey(rawCell);
  const canonical = HEADER_ALIAS_TO_CANONICAL.get(key);
  return canonical ?? key;
}

/**
 * Normalize a header label for matching. Lowercase, strip diacritics,
 * collapse whitespace / underscore / hyphen runs into single spaces.
 */
function normalizeHeaderKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks (diacritics)
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim()
    // Canonical names use underscores; map normalized "term start" →
    // "term_start" so the existing lookup table doesn't need to change.
    .replace(/ /g, "_");
}

/** True only for a date string that round-trips to the same calendar day —
 *  i.e. an actual day on the Gregorian calendar, not a rollover like Feb 30. */
function isRealCalendarDate(yyyyMmDd: string): boolean {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === yyyyMmDd;
}

function escapeCsvCell(value: string): string {
  if (value === "") return "";
  // Excel / Google Sheets / Numbers treat a cell beginning with `=` `+` `-` `@`
  // (and tab/CR) as a FORMULA, executing whatever follows. User-controlled
  // fields (vendor name, notes, …) export verbatim through this path. Prefix
  // a single-quote — the conventional spreadsheet "treat as text" escape —
  // so a malicious payload like `=HYPERLINK(...)` shows up as text, not a
  // live formula. Done BEFORE the RFC-4180 quoting below.
  let safe = value;
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = "'" + safe;
  }
  // RFC 4180: any cell containing a comma, double-quote, CR, or LF must be
  // double-quoted; embedded double-quotes are doubled.
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Normalize tabular text from any of the common clipboard / file shapes
 * into the CSV format `parseSubscriptionCsv` expects.
 *
 * Real-world inputs:
 *   - **Excel paste** uses tabs as field separators. Cells can contain
 *     commas (e.g. "Slack, Inc.") without quoting because the separator
 *     isn't a comma.
 *   - **Google Sheets paste** is also TSV by default.
 *   - **macOS Numbers paste** is TSV.
 *   - **A saved CSV file** is CSV — comma separated, quoted where needed.
 *   - **Mixed clipboards** can carry both representations; the browser
 *     picks one. We sniff and pick the right path.
 *
 * Why sniff first vs always converting: a well-formed CSV with vendor names
 * like "Acme, Inc." would be mis-parsed if we naively split on tabs (no
 * tabs to split on, so the row would be left as one giant cell). The
 * sniff catches CSV-shaped input early and returns it unchanged.
 *
 * Algorithm:
 *   1. Count tabs vs commas in the first 1 KB. Whichever is more frequent
 *      is the delimiter. Ties favor CSV (the canonical format).
 *   2. If CSV, return unchanged.
 *   3. If TSV, split on physical newlines (tabs cannot span lines in
 *      Excel paste), split each line on \t, escape each cell per CSV
 *      rules, join with commas.
 */
export function normalizeTabularInput(text: string): string {
  if (text.length === 0) return text;
  const sample = text.slice(0, 1024);
  let tabs = 0;
  let commas = 0;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (ch === "\t") tabs++;
    else if (ch === ",") commas++;
  }
  if (tabs === 0 || commas >= tabs) return text;

  // TSV → CSV. Excel paste uses physical CRLF/LF/CR; embedded newlines
  // inside a cell are NOT supported by spreadsheet paste (they break the
  // row), so a plain split is correct here.
  const lines = text.split(/\r\n|\n|\r/);
  const csvLines: string[] = [];
  for (const line of lines) {
    if (line === "" && csvLines.length === lines.length - 1) {
      // Trailing blank line from a copy-paste — drop it so we don't
      // produce a phantom empty CSV row.
      continue;
    }
    const cells = line.split("\t").map((c) => escapeCsvCell(c));
    csvLines.push(cells.join(","));
  }
  return csvLines.join("\n");
}
