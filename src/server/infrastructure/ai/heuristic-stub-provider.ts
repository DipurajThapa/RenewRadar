/**
 * Heuristic AI provider — covers both the extraction interface and the
 * insight interface. Used in dev + tests until ANTHROPIC_API_KEY is
 * provisioned. The production swap is the Anthropic provider — same two
 * interfaces, real Claude calls.
 *
 * Extraction stack:
 *   - Regex pattern matching for the six canonical fields.
 *   - Every match comes back with the typed parsedValueJson, a verbatim
 *     evidenceQuote, page number when pageBreaks are provided, and a
 *     confidence reflecting pattern strength.
 *   - Conservative: when a match is weak or ambiguous, we return nothing
 *     rather than guess. Mirrors the "evidence-or-reject" binding principle.
 *
 * Insight stack:
 *   - Pure deterministic templates over the structured input. No randomness,
 *     no string interpolation that depends on the time of day. Same input
 *     always produces same output so tests can assert verbatim.
 *   - Each insight method emits a confidencePct that reflects the strength
 *     of the underlying signal (e.g. a missed deadline = 95; a vague
 *     intermediate risk score = 60).
 *
 * Cost is always 0 (no API call). pagesCharged tracks the page count so
 * usage UX is realistic in dev.
 */
import type {
  AIInsightProvider,
  ExtractedFieldDraft,
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
  RiskExplainerInput,
  RiskExplainerOutput,
  SavingsNarrativeInput,
  SavingsNarrativeOutput,
  VendorIntelligenceInput,
  VendorIntelligenceOutput,
} from "./types";

const PROVIDER_NAME = "heuristic-stub";
const MODEL = "heuristic-v1";
const PROMPT_VERSION = "v1.0";
const MAX_QUOTE_LEN = 300;

export class HeuristicStubProvider
  implements ExtractionProvider, AIInsightProvider
{
  readonly providerName = PROVIDER_NAME;
  readonly model = MODEL;
  readonly promptVersion = PROMPT_VERSION;

  // ─── Extraction ────────────────────────────────────────────────────────

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

    // pagesCharged — prefer the explicit pageCount from the OCR layer; fall
    // back to `pageBreaks.length + 1` (correct for PDFs because pageBreaks
    // is the list of N-1 cumulative offsets between N pages); finally clamp
    // to 1 so plain-text/DOCX never appears free.
    const pagesCharged =
      typeof input.pageCount === "number" && input.pageCount > 0
        ? input.pageCount
        : Math.max(1, (input.pageBreaks?.length ?? 0) + 1);

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

  // ─── Insights ──────────────────────────────────────────────────────────

  async explainRisk(input: RiskExplainerInput): Promise<RiskExplainerOutput> {
    const dollars = Math.round(input.annualValueCents / 100);
    const dollarsFmt = formatDollars(dollars);

    let headline: string;
    let rationale: string;
    const suggestedActions: string[] = [];

    if (input.isMissed) {
      headline = `Notice window for ${input.productName} has passed`;
      rationale = `The notice deadline closed ${Math.abs(input.daysUntilNoticeDeadline)} days ago. ${
        input.autoRenew
          ? `Because ${input.vendorName} auto-renews, the contract has already rolled.`
          : `${input.vendorName} does not auto-renew, but the agreed window to opt out is closed.`
      } Re-engage the vendor directly to discuss off-cycle terms.`;
      suggestedActions.push(
        `Email ${input.vendorName} to confirm next steps`,
        "Log a renewal decision so the ledger reflects what actually happened"
      );
    } else if (input.riskBand === "high") {
      const why: string[] = [];
      if (input.components.urgency >= 50) why.push("the notice window is short");
      if (input.components.value >= 20)
        why.push(`the contract is large (${dollarsFmt}/yr)`);
      if (input.autoRenew) why.push("auto-renew is on");
      headline = `${input.productName} renewal needs attention`;
      rationale = `Score ${input.riskScore} (high) because ${joinWithAnd(why)}. ${
        input.daysUntilNoticeDeadline > 0
          ? `You have ${input.daysUntilNoticeDeadline} days to decide.`
          : "The notice window is at or past its end."
      }`;
      suggestedActions.push(
        "Open the decide-now page and pick an action",
        input.autoRenew
          ? `Confirm whether ${input.vendorName} will pause auto-renew during negotiation`
          : "Confirm the renewal terms with the vendor in writing"
      );
    } else if (input.riskBand === "medium") {
      headline = `${input.productName} renewal — review this week`;
      rationale = `Score ${input.riskScore} (medium). The deadline is ${input.daysUntilNoticeDeadline} days out and the value is ${dollarsFmt}/yr. ${
        input.autoRenew
          ? "Auto-renew is on, so quiet inaction means roll-over."
          : "Auto-renew is off, so a missed deadline means lapse."
      }`;
      suggestedActions.push(
        "Confirm usage with the product owner before deciding",
        "Pull the latest invoice to check for price drift"
      );
    } else {
      headline = `${input.productName} renewal — low urgency`;
      rationale = `Score ${input.riskScore} (low). ${input.daysUntilNoticeDeadline} days to the notice deadline, ${dollarsFmt}/yr in contract value. No immediate action needed.`;
      suggestedActions.push(
        "Revisit when the contract enters the 30-day window"
      );
    }

    return {
      meta: {
        provider: PROVIDER_NAME,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        confidencePct: deriveRiskConfidence(input),
      },
      headline,
      rationale,
      suggestedActions,
    };
  }

  async summarizeVendorIntelligence(
    input: VendorIntelligenceInput
  ): Promise<VendorIntelligenceOutput> {
    const savedDollars = Math.round(input.totalSavedAnnualCents / 100);
    const highlights: string[] = [];
    const summaryParts: string[] = [];

    summaryParts.push(
      `Tracking ${input.vendorName} for ${input.yearsTracked < 1 ? "less than a year" : `${Math.round(input.yearsTracked)} year${input.yearsTracked >= 2 ? "s" : ""}`} across ${input.activeSubscriptions} active subscription${input.activeSubscriptions === 1 ? "" : "s"}.`
    );
    if (savedDollars > 0) {
      summaryParts.push(
        `${formatDollars(savedDollars)} saved annualized to date.`
      );
    }

    if (input.cancelledSubscriptions > 0) {
      highlights.push(
        `${input.cancelledSubscriptions} subscription${input.cancelledSubscriptions === 1 ? "" : "s"} cancelled previously.`
      );
    }
    if (input.averagePriceChangePct !== null) {
      const pct = input.averagePriceChangePct;
      if (pct >= 5) {
        highlights.push(
          `Average price change of ${pct.toFixed(1)}% — expect upward pressure at renewal.`
        );
      } else if (pct <= -5) {
        highlights.push(
          `Average price change of ${pct.toFixed(1)}% — net downward trend.`
        );
      } else {
        highlights.push(
          `Price has held within ±5% across renewals — vendor pricing is stable.`
        );
      }
    }
    if (savedDollars > 0) {
      highlights.push(
        `${formatDollars(savedDollars)} in annualized savings recorded.`
      );
    }
    if (input.lastDecisionLabel && input.lastDecisionDate) {
      highlights.push(
        `Last decision: ${humanizeDecision(input.lastDecisionLabel)} on ${input.lastDecisionDate}.`
      );
    }
    if (input.expiringComplianceArtifacts > 0) {
      highlights.push(
        `${input.expiringComplianceArtifacts} compliance artifact${input.expiringComplianceArtifacts === 1 ? "" : "s"} expiring soon — request renewals.`
      );
    } else if (input.complianceArtifacts > 0) {
      highlights.push(
        `${input.complianceArtifacts} compliance artifact${input.complianceArtifacts === 1 ? "" : "s"} on file.`
      );
    }
    if (highlights.length === 0) {
      highlights.push(
        "No multi-renewal history yet — patterns will emerge after the first renewal cycle."
      );
    }

    return {
      meta: {
        provider: PROVIDER_NAME,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        confidencePct:
          input.yearsTracked < 1
            ? 55
            : input.activeSubscriptions + input.cancelledSubscriptions >= 3
              ? 85
              : 70,
      },
      summary: summaryParts.join(" "),
      highlights: highlights.slice(0, 4),
    };
  }

  async narrateSavings(
    input: SavingsNarrativeInput
  ): Promise<SavingsNarrativeOutput> {
    const baseline = formatDollars(
      Math.round(input.baselineAnnualUsdCents / 100)
    );
    const saved = formatDollars(
      Math.round(input.savedAnnualUsdCents / 100)
    );

    let narrative: string;
    let confidence = 75;
    if (input.savedAnnualUsdCents <= 0) {
      narrative = `Flat renewal of ${input.productName} at ${baseline}/yr — no savings booked.`;
      confidence = 90;
    } else if (input.kind === "cancelled") {
      narrative = `Cancelled ${input.productName}; ${saved}/yr returned to the budget.`;
      confidence = 95;
    } else if (input.kind === "downgraded") {
      narrative = `Downgraded ${input.productName}; saved ${saved}/yr by right-sizing usage.`;
      confidence = 85;
    } else if (
      input.kind === "renegotiated" &&
      input.negotiationLever &&
      input.negotiationLever !== "none"
    ) {
      narrative = `Renegotiated ${input.productName} via ${humanizeLever(input.negotiationLever)}; saved ${saved}/yr.`;
      confidence = 88;
    } else if (input.kind === "avoided_increase") {
      narrative = `Held the line on ${input.productName} pricing; ${saved}/yr in avoided increase.`;
      confidence = 80;
    } else {
      narrative = `Saved ${saved}/yr on ${input.productName} (${humanizeKind(input.kind)}).`;
      confidence = 70;
    }

    return {
      meta: {
        provider: PROVIDER_NAME,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        confidencePct: confidence,
      },
      narrative,
    };
  }
}

// ─── shared formatting helpers ──────────────────────────────────────────────

/**
 * Confidence for the risk insight, DERIVED from the real signal rather than a
 * flat per-band constant (which read as a fake calibrated probability). It
 * tracks (a) how decisive the deterministic risk score is and (b) how complete
 * the backing signals are — more signal → more confidence. Rounded to the
 * nearest 5 so it never implies false precision.
 */
function deriveRiskConfidence(input: RiskExplainerInput): number {
  // A closed notice window is an observed fact, not a judgment call.
  if (input.isMissed) return 95;

  // Signal completeness: each real signal that's actually present raises how
  // confident we are the call is well-supported.
  const present = [
    input.components.urgency > 0,
    input.components.value > 0,
    input.autoRenew,
    input.components.clausePressure > 0,
  ].filter(Boolean).length;
  const completeness = present / 4; // 0..1

  // Confidence rises with the real risk score and with signal completeness —
  // a clearly-low-risk row is a low-confidence "needs attention" call, a
  // well-supported high-risk row a high-confidence one. Rounded to the nearest
  // 5 so it never implies false calibration.
  const pct = 50 + (input.riskScore / 100) * 30 + completeness * 12;
  return Math.max(50, Math.min(92, Math.round(pct / 5) * 5));
}

function formatDollars(dollars: number): string {
  if (dollars >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(1)}M`;
  }
  if (dollars >= 10_000) {
    return `$${Math.round(dollars / 1_000)}K`;
  }
  if (dollars >= 1_000) {
    return `$${(dollars / 1_000).toFixed(1)}K`;
  }
  return `$${dollars.toLocaleString("en-US")}`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function humanizeDecision(label: string): string {
  return label
    .split("_")
    .map((w) => (w === "with" ? "with" : w))
    .join(" ");
}

function humanizeLever(lever: string): string {
  switch (lever) {
    case "multi_year_commit":
      return "a multi-year commitment";
    case "payment_terms":
      return "payment-term improvements";
    case "volume_increase":
      return "a volume increase";
    case "competing_quote":
      return "a competing quote";
    case "executive_escalation":
      return "executive escalation";
    case "consolidated_with_other_products":
      return "product consolidation";
    case "threatened_cancellation":
      return "a credible cancellation threat";
    default:
      return lever.replace(/_/g, " ");
  }
}

function humanizeKind(kind: string): string {
  switch (kind) {
    case "renegotiated":
      return "renegotiation";
    case "downgraded":
      return "downgrade";
    case "cancelled":
      return "cancellation";
    case "avoided_increase":
      return "avoided increase";
    default:
      return kind.replace(/_/g, " ");
  }
}

// ─── extraction helpers ─────────────────────────────────────────────────────

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
