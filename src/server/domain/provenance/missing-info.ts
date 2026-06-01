/**
 * Derived "missing information" — which obligation-generic facts a renewal item
 * does NOT yet have a trustworthy value for. The directive requires every AI
 * output to surface what's missing, not just what's known. Like the provenance
 * label, this is a PURE DERIVATION over the subscription row + its extracted
 * fields — no new store.
 *
 * A fact is:
 *   - MISSING   when the source-of-truth value is absent and nothing was extracted
 *   - UNCERTAIN when the value is absent but a low/medium-confidence field exists
 *     (we have a guess, just not a confident one)
 *
 * Facts already present on the subscription are simply omitted from the list.
 */
import type { RenewalItemCategory } from "@server/infrastructure/db/schema";

export type MissingFieldKey =
  | "renewal_date"
  | "notice_period_days"
  | "contract_value_cents"
  | "cancellation_method"
  | "price_increase_clause"
  | "issuer"
  | "reference_number";

export type MissingField = {
  key: MissingFieldKey;
  label: string;
  reason: "missing" | "uncertain";
  detail: string;
};

/** The slice of a renewal item this derivation reads. Callers project their
 *  subscription row into this shape so the function stays pure + unit-testable. */
export type RenewalItemFacts = {
  category: RenewalItemCategory;
  termEndDate: string | null;
  noticePeriodDays: number | null;
  totalCostPerPeriodCents: number | null;
  cancellationMethodCode: string | null;
  priceIncreaseClauseText: string | null;
  attributes: Record<string, unknown>;
};

/** A pending extracted field that gives us a non-confident guess for a key. */
export type UncertainFieldSignal = {
  fieldKey: string;
  /** True when fieldProvenance() rated this field below "verified". */
  isUncertain: boolean;
};

/** Categories where a third-party issuer + a policy/cert/notice reference number
 *  are core identifying facts (a SaaS subscription has neither). */
const ISSUER_REFERENCE_CATEGORIES: ReadonlySet<RenewalItemCategory> = new Set([
  "insurance_policy",
  "compliance_cert",
  "government_notice",
  "warranty_amc",
  "professional_membership",
]);

function reasonFor(
  key: string,
  uncertainKeys: ReadonlySet<string>
): "missing" | "uncertain" {
  return uncertainKeys.has(key) ? "uncertain" : "missing";
}

/**
 * Compute the missing-info list for one renewal item. `renewalDateKey` adapts
 * the label: a SaaS contract "renews", everything else "expires".
 */
export function computeMissingInfo(
  facts: RenewalItemFacts,
  uncertainSignals: UncertainFieldSignal[] = []
): MissingField[] {
  const uncertainKeys = new Set(
    uncertainSignals.filter((s) => s.isUncertain).map((s) => s.fieldKey)
  );
  const out: MissingField[] = [];
  const isSaas = facts.category === "saas_subscription";

  // Renewal / expiry date.
  if (!facts.termEndDate) {
    out.push({
      key: "renewal_date",
      label: isSaas ? "Renewal date" : "Expiry date",
      reason: reasonFor("renewal_date", uncertainKeys),
      detail: isSaas
        ? "No term end date — can't compute a notice deadline."
        : "No expiry date — can't alert before it lapses.",
    });
  }

  // Notice period (0 or null = we can't compute when to act).
  if (facts.noticePeriodDays == null || facts.noticePeriodDays <= 0) {
    out.push({
      key: "notice_period_days",
      label: "Notice period",
      reason: reasonFor("notice_period_days", uncertainKeys),
      detail: "No notice window recorded — deadline defaults to the term end.",
    });
  }

  // Contract value.
  if (
    facts.totalCostPerPeriodCents == null ||
    facts.totalCostPerPeriodCents <= 0
  ) {
    out.push({
      key: "contract_value_cents",
      label: "Contract value",
      reason: reasonFor("contract_value_cents", uncertainKeys),
      detail: "No cost recorded — exposure and savings can't be quantified.",
    });
  }

  // Cancellation method.
  if (!facts.cancellationMethodCode) {
    out.push({
      key: "cancellation_method",
      label: "Cancellation method",
      reason: reasonFor("cancellation_method", uncertainKeys),
      detail: "Unknown how to give notice — confirm the cancellation path.",
    });
  }

  // Price-increase clause (only flag if not already captured as text).
  if (!facts.priceIncreaseClauseText) {
    out.push({
      key: "price_increase_clause",
      label: "Price-increase clause",
      reason: reasonFor("price_increase_clause", uncertainKeys),
      detail: "Not captured — a flat renewal may hide an automatic uplift.",
    });
  }

  // Issuer + reference number — only meaningful for non-SaaS obligations.
  if (ISSUER_REFERENCE_CATEGORIES.has(facts.category)) {
    if (!facts.attributes.issuer) {
      out.push({
        key: "issuer",
        label: "Issuer",
        reason: reasonFor("issuer", uncertainKeys),
        detail: "No issuing body recorded.",
      });
    }
    if (!facts.attributes.referenceNumber) {
      out.push({
        key: "reference_number",
        label: "Reference number",
        reason: reasonFor("reference_number", uncertainKeys),
        detail: "No policy/cert/notice reference recorded.",
      });
    }
  }

  return out;
}

// ─── Document-centric variant (review-queue) ─────────────────────────────────
// `computeMissingInfo` above answers "what does this RENEWAL ITEM still lack"
// (needs the subscription row). On the review queue we group by DOCUMENT and
// only have the extracted field keys, so the useful question there is the
// narrower "which core facts did THIS document fail to yield" — answerable from
// the field keys alone, no extra loading.

export const CORE_EXTRACTABLE_FIELDS: ReadonlyArray<{
  key: string;
  label: string;
}> = [
  { key: "renewal_date", label: "Renewal / expiry date" },
  { key: "notice_period_days", label: "Notice period" },
  { key: "contract_value_cents", label: "Contract value" },
  { key: "cancellation_method", label: "Cancellation method" },
  { key: "price_increase_clause", label: "Price-increase clause" },
];

/**
 * Of the core extractable facts, which ones have NO field in the given set.
 * `expiry_date` satisfies the date slot just as `renewal_date` does (the
 * obligation-generic alias from Phase 1).
 */
export function extractableFieldsNotPresent(
  presentFieldKeys: string[]
): Array<{ key: string; label: string }> {
  const present = new Set(presentFieldKeys);
  const satisfied = (key: string) =>
    present.has(key) ||
    (key === "renewal_date" && present.has("expiry_date"));
  return CORE_EXTRACTABLE_FIELDS.filter((f) => !satisfied(f.key)).map((f) => ({
    key: f.key,
    label: f.label,
  }));
}
