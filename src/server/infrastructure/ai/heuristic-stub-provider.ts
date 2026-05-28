/**
 * Heuristic AI extraction stub.
 *
 * Used in dev + tests until ANTHROPIC_API_KEY is provisioned. The
 * production swap is `anthropic-provider.ts` — same interface, real Claude
 * Sonnet 4.6 call with the structured-extraction prompt.
 *
 * This stub uses regex pattern matching against the document text to find
 * the six canonical fields. Every successful match comes back with:
 *   - the typed parsedValueJson
 *   - a verbatim evidenceQuote pulled from the source
 *   - a page number when pageBreaks are provided
 *   - a confidence score that reflects pattern strength
 *
 * The stub is intentionally conservative: when a match is weak or ambiguous,
 * it returns nothing rather than a guess. That mirrors the production
 * contract — "evidence-or-reject" is the binding principle.
 *
 * Cost is 0 (no API call); pagesCharged tracks the page count anyway so the
 * usage UX is realistic in dev.
 */
import type {
  ExtractedFieldDraft,
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
} from "./types";

const PROVIDER_NAME = "heuristic-stub";
const MODEL = "heuristic-v1";
const PROMPT_VERSION = "v1.0";
const MAX_QUOTE_LEN = 300;

export class HeuristicStubProvider implements ExtractionProvider {
  readonly providerName = PROVIDER_NAME;
  readonly model = MODEL;
  readonly promptVersion = PROMPT_VERSION;

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const fields: ExtractedFieldDraft[] = [];

    const renewalDate = extractRenewalDate(input);
    if (renewalDate) fields.push(renewalDate);

    const noticePeriod = extractNoticePeriod(input);
    if (noticePeriod) fields.push(noticePeriod);

    const autoRenewal = extractAutoRenewal(input);
    if (autoRenewal) fields.push(autoRenewal);

    const contractValue = extractContractValue(input);
    if (contractValue) fields.push(contractValue);

    const priceIncrease = extractPriceIncreaseClause(input);
    if (priceIncrease) fields.push(priceIncrease);

    const cancellation = extractCancellationMethod(input);
    if (cancellation) fields.push(cancellation);

    const pagesCharged = Math.max(1, input.pageBreaks?.length ?? 1);

    return {
      meta: {
        provider: PROVIDER_NAME,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        costUsdMicros: 0,
        pagesCharged,
      },
      fields,
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function pageNumberFor(
  matchIndex: number,
  pageBreaks: number[] | undefined
): number | null {
  if (!pageBreaks || pageBreaks.length === 0) return null;
  // pageBreaks is a sorted list of cumulative character offsets at which a
  // new page begins. Page 1 starts at offset 0.
  let page = 1;
  for (let i = 0; i < pageBreaks.length; i++) {
    if (matchIndex >= pageBreaks[i]!) page = i + 2;
    else break;
  }
  return page;
}

function quote(text: string, start: number, end: number): string {
  // Expand to nearest sentence boundary, then clamp.
  let s = start;
  while (s > 0 && !/[.\n]/.test(text[s - 1]!)) s--;
  let e = end;
  while (e < text.length && !/[.\n]/.test(text[e]!)) e++;
  if (e < text.length) e++;
  const raw = text.slice(s, e).trim();
  return raw.length > MAX_QUOTE_LEN
    ? raw.slice(0, MAX_QUOTE_LEN - 1) + "…"
    : raw;
}

// ─── field extractors ───────────────────────────────────────────────────────

function extractRenewalDate(input: ExtractionInput): ExtractedFieldDraft | null {
  // Look for phrasing like "renewal date", "renew on", "ends on", "expires on"
  // followed (within ~30 chars) by a date. Prefer ISO; fall back to
  // "Month DD, YYYY".
  const TRIGGER = "(?:renewal date|renew(?:al)? on|renew on|term (?:end|ends|ending)|ends on|expires? on|valid through|valid until)";
  const patterns: RegExp[] = [
    new RegExp(`\\b${TRIGGER}[\\s\\S]{0,30}?(\\d{4}-\\d{2}-\\d{2})`, "i"),
    new RegExp(
      `\\b${TRIGGER}[\\s\\S]{0,30}?(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s*(\\d{4})`,
      "i"
    ),
  ];
  for (const pat of patterns) {
    const m = pat.exec(input.text);
    if (!m) continue;
    let iso: string | null = null;
    if (m[1] && /^\d{4}-\d{2}-\d{2}$/.test(m[1])) {
      iso = m[1];
    } else if (m[1] && m[2] && m[3]) {
      const month = monthNumber(m[1]);
      if (month) {
        const day = String(parseInt(m[2], 10)).padStart(2, "0");
        iso = `${m[3]}-${month}-${day}`;
      }
    }
    if (!iso) continue;
    const start = m.index;
    const end = start + m[0].length;
    return {
      fieldKey: "renewal_date",
      rawValue: m[0],
      parsedValueJson: { date: iso },
      confidencePct: 88,
      evidenceQuote: quote(input.text, start, end),
      evidencePageNumber: pageNumberFor(start, input.pageBreaks),
    };
  }
  return null;
}

function extractNoticePeriod(input: ExtractionInput): ExtractedFieldDraft | null {
  // Two flavors:
  //   1. "30 days [prior|advance] written notice"
  //   2. "...notice to the other party at least 90 days prior to..."
  // We try the tighter pattern first, then fall back to "at least N days
  // prior" anywhere within ~80 chars of a "notice" keyword.
  const tight = /\b(\d{1,3})[-\s]?(?:days?|day)\s+(?:prior\s+|advance\s+)?(?:written\s+)?notice\b/i;
  let m = tight.exec(input.text);
  if (m && m[1]) {
    const days = parseInt(m[1], 10);
    if (Number.isFinite(days) && days > 0 && days <= 365) {
      return makeNoticeField(input, m, days, 92);
    }
  }
  // Loose: look for "notice" then "at least N days" within a window. `[^.]`
  // allows newlines (most contracts wrap mid-clause) but stops at period
  // (which usually ends the clause).
  const loose = /\bnotice\b[^.]{0,160}?\bat\s+least\s+(\d{1,3})\s+days?\s+(?:prior|in\s+advance|before)\b/i;
  m = loose.exec(input.text);
  if (m && m[1]) {
    const days = parseInt(m[1], 10);
    if (Number.isFinite(days) && days > 0 && days <= 365) {
      return makeNoticeField(input, m, days, 88);
    }
  }
  return null;
}

function makeNoticeField(
  input: ExtractionInput,
  match: RegExpExecArray,
  days: number,
  confidence: number
): ExtractedFieldDraft {
  const start = match.index;
  const end = start + match[0].length;
  return {
    fieldKey: "notice_period_days",
    rawValue: match[0],
    parsedValueJson: { days },
    confidencePct: confidence,
    evidenceQuote: quote(input.text, start, end),
    evidencePageNumber: pageNumberFor(start, input.pageBreaks),
  };
}

function extractAutoRenewal(input: ExtractionInput): ExtractedFieldDraft | null {
  // Three signals: explicit yes, explicit no, mention of automatic renewal
  const yesPat =
    /\b(?:auto(?:matic|matically)?[\s-]renew(?:al|s|ed|ing)?|shall\s+(?:automatically\s+)?renew|will\s+(?:automatically\s+)?renew)\b/i;
  const noPat =
    /\b(?:no\s+auto(?:matic)?\s+renewal|does\s+not\s+(?:automatically\s+)?renew|requires?\s+mutual\s+(?:written\s+)?agreement\s+to\s+renew)\b/i;
  const noMatch = noPat.exec(input.text);
  if (noMatch) {
    const start = noMatch.index;
    const end = start + noMatch[0].length;
    return {
      fieldKey: "auto_renewal",
      rawValue: noMatch[0],
      parsedValueJson: { yes: false },
      confidencePct: 90,
      evidenceQuote: quote(input.text, start, end),
      evidencePageNumber: pageNumberFor(start, input.pageBreaks),
    };
  }
  const yesMatch = yesPat.exec(input.text);
  if (yesMatch) {
    const start = yesMatch.index;
    const end = start + yesMatch[0].length;
    return {
      fieldKey: "auto_renewal",
      rawValue: yesMatch[0],
      parsedValueJson: { yes: true },
      confidencePct: 86,
      evidenceQuote: quote(input.text, start, end),
      evidencePageNumber: pageNumberFor(start, input.pageBreaks),
    };
  }
  return null;
}

function extractContractValue(
  input: ExtractionInput
): ExtractedFieldDraft | null {
  // "$12,000 per year", "annual fee of $5,000", "USD 24,000 annually"
  const patterns: RegExp[] = [
    /\$\s?([\d,]+(?:\.\d{2})?)\s+(?:per\s+(?:year|annum)|annually|\/yr|annual)/i,
    /(?:annual\s+(?:fee|cost|amount)|annual\s+contract\s+value)[^\d]{1,30}\$\s?([\d,]+(?:\.\d{2})?)/i,
    /USD\s+([\d,]+(?:\.\d{2})?)\s+(?:per\s+(?:year|annum)|annually)/i,
  ];
  for (const pat of patterns) {
    const m = pat.exec(input.text);
    if (!m || !m[1]) continue;
    const dollars = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    const cents = Math.round(dollars * 100);
    const start = m.index;
    const end = start + m[0].length;
    return {
      fieldKey: "contract_value_cents",
      rawValue: m[0],
      parsedValueJson: { cents, currency: "USD" },
      confidencePct: 84,
      evidenceQuote: quote(input.text, start, end),
      evidencePageNumber: pageNumberFor(start, input.pageBreaks),
    };
  }
  return null;
}

function extractPriceIncreaseClause(
  input: ExtractionInput
): ExtractedFieldDraft | null {
  // "may increase fees by up to X%", "annual uplift", "CPI"
  const patterns: RegExp[] = [
    /\b(?:may|reserves?\s+the\s+right\s+to|shall\s+be\s+permitted\s+to)\s+increase\s+(?:fees?|prices?|charges?)\s+(?:by\s+)?(?:up\s+to\s+)?[^.\n]{1,80}\b\d+(?:\.\d+)?%/i,
    /\bannual\s+(?:price\s+)?(?:uplift|escalation|increase)[^.\n]{0,60}/i,
    /\bbased\s+on\s+(?:CPI|the\s+Consumer\s+Price\s+Index)[^.\n]{0,60}/i,
  ];
  for (const pat of patterns) {
    const m = pat.exec(input.text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    return {
      fieldKey: "price_increase_clause",
      rawValue: m[0],
      parsedValueJson: { clause: m[0] },
      confidencePct: 78,
      evidenceQuote: quote(input.text, start, end),
      evidencePageNumber: pageNumberFor(start, input.pageBreaks),
    };
  }
  return null;
}

function extractCancellationMethod(
  input: ExtractionInput
): ExtractedFieldDraft | null {
  // Order matters — more specific signals (email / portal / account manager)
  // win over the generic "written notice" fallback. If a contract says
  // "delivering written notice via email", we want method=email, not
  // method=written_notice.
  const patterns: { regex: RegExp; method: "email" | "written_notice" | "portal" | "account_manager"; confidence: number }[] = [
    {
      regex: /\b(?:notify|send\s+notice|deliver(?:ed|ing)?)\s+(?:written\s+notice\s+)?(?:by|via|through)\s+(?:email|electronic\s+mail)\b/i,
      method: "email",
      confidence: 88,
    },
    {
      regex: /\bvia\s+email\s+to\b/i,
      method: "email",
      confidence: 82,
    },
    {
      regex: /\b(?:through|via|using)\s+the\s+(?:customer|account)\s+portal\b/i,
      method: "portal",
      confidence: 85,
    },
    {
      regex: /\bcontact(?:ing)?\s+(?:your\s+)?account\s+manager\b/i,
      method: "account_manager",
      confidence: 82,
    },
    {
      regex: /\b(?:written\s+notice|notice\s+in\s+writing)\b/i,
      method: "written_notice",
      confidence: 70,
    },
  ];
  for (const { regex, method, confidence } of patterns) {
    const m = regex.exec(input.text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    return {
      fieldKey: "cancellation_method",
      rawValue: m[0],
      parsedValueJson: { method },
      confidencePct: confidence,
      evidenceQuote: quote(input.text, start, end),
      evidencePageNumber: pageNumberFor(start, input.pageBreaks),
    };
  }
  return null;
}

function monthNumber(name: string): string | null {
  const map: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  return map[name.toLowerCase()] ?? null;
}
