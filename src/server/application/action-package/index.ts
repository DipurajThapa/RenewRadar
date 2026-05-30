/**
 * Per-item action package — a READ-TIME view-model, never a stored entity
 * (the do-NOT-build list forbids an `action_package` table). It assembles, from
 * the already-computed brief + notice draft + the derived missing-info, the
 * "everything teed up for this renewal" panel: the recommendation (with its
 * provenance band), the reminder line, the questions to ask, what's still
 * missing, and a one-item calendar link.
 *
 * Pure + synchronous: the page loads the rows it already needs and hands them
 * here, so this is trivially unit-testable and has no clock/DB dependency. The
 * autonomy boundary holds — every field is prepared for a human to act on;
 * nothing here sends, signs, or commits anything.
 */
import type { RenewalIntelligenceBrief } from "@server/infrastructure/ai/reasoning/types";
import {
  claimProvenance,
  type ProvenanceLabel,
} from "@server/domain/provenance/labels";
import {
  computeMissingInfo,
  type MissingField,
  type RenewalItemFacts,
  type UncertainFieldSignal,
} from "@server/domain/provenance/missing-info";

export type AssembleActionPackageInput = {
  vendorName: string;
  productName: string;
  facts: RenewalItemFacts;
  /** From the open renewal_event (null when none / not yet scheduled). */
  noticeDeadline: string | null;
  renewalDate: string | null;
  /** Caller computes this against the system clock to keep the assembler pure. */
  daysUntilNoticeDeadline: number | null;
  brief: RenewalIntelligenceBrief | null;
  /** brief.createdByUserId === null → prepared by the autonomous agent. */
  briefBySystem: boolean;
  hasNoticeDraft: boolean;
  noticeDraftBySystem: boolean;
  /** Pending extracted fields whose provenance band is below "verified". */
  uncertainSignals: UncertainFieldSignal[];
  icsHref: string;
};

export type ActionPackage = {
  recommendedAction: string | null;
  recommendationProvenance: ProvenanceLabel | null;
  headline: string | null;
  reminderLine: string;
  vendorQuestions: string[];
  missingInfo: MissingField[];
  hasNoticeDraft: boolean;
  /** True when the brief and/or notice draft was auto-prepared by the agent. */
  preparedBySystem: boolean;
  icsHref: string;
};

/** Deterministic question copy per missing fact. */
function questionForMissing(
  m: MissingField,
  vendorName: string,
  productName: string
): string {
  const item = `${vendorName} — ${productName}`;
  switch (m.key) {
    case "renewal_date":
      return `Confirm the exact ${m.label.toLowerCase()} for ${item}.`;
    case "notice_period_days":
      return `What notice period is required to cancel ${item}?`;
    case "contract_value_cents":
      return `Confirm the current annual cost of ${item}.`;
    case "cancellation_method":
      return `How do we give notice to cancel ${item} (email, portal, account manager)?`;
    case "price_increase_clause":
      return `Does the ${vendorName} agreement include an automatic price-increase clause?`;
    case "issuer":
      return `Who is the issuing body for ${item}?`;
    case "reference_number":
      return `What is the policy / reference number for ${item}?`;
    default:
      return `Confirm the ${m.label.toLowerCase()} for ${item}.`;
  }
}

export function assembleActionPackage(
  input: AssembleActionPackageInput
): ActionPackage {
  const missingInfo = computeMissingInfo(input.facts, input.uncertainSignals);

  // Recommendation rides the brief — the single reasoning surface.
  let recommendedAction: string | null = null;
  let recommendationProvenance: ProvenanceLabel | null = null;
  let headline: string | null = null;
  if (input.brief) {
    recommendedAction = input.brief.recommendedAction;
    headline = input.brief.headline;
    const recClaim = input.brief.claims.find(
      (c) => c.key === "recommended_action"
    );
    if (recClaim) recommendationProvenance = claimProvenance(recClaim);
  }

  // Questions: one per missing fact, plus the brief's leverage talking point.
  const vendorQuestions = missingInfo.map((m) =>
    questionForMissing(m, input.vendorName, input.productName)
  );
  const leverageClaim = input.brief?.claims.find((c) => c.key === "leverage");
  if (leverageClaim) {
    vendorQuestions.push(`Raise in negotiation: ${leverageClaim.statement}`);
  }

  return {
    recommendedAction,
    recommendationProvenance,
    headline,
    reminderLine: buildReminderLine(input),
    vendorQuestions,
    missingInfo,
    hasNoticeDraft: input.hasNoticeDraft,
    preparedBySystem: input.briefBySystem || input.noticeDraftBySystem,
    icsHref: input.icsHref,
  };
}

function buildReminderLine(input: AssembleActionPackageInput): string {
  const { noticeDeadline, renewalDate, daysUntilNoticeDeadline, vendorName } =
    input;
  if (!noticeDeadline) {
    return "No notice deadline recorded yet — add a term end date to schedule alerts.";
  }
  if (daysUntilNoticeDeadline != null && daysUntilNoticeDeadline < 0) {
    return `Notice window closed ${Math.abs(
      daysUntilNoticeDeadline
    )} day(s) ago — confirm whether ${vendorName} already auto-renewed and log the outcome.`;
  }
  const days =
    daysUntilNoticeDeadline != null
      ? `${daysUntilNoticeDeadline} day(s) away`
      : "upcoming";
  const renews = renewalDate ? ` or ${vendorName} auto-renews on ${renewalDate}` : "";
  return `Notice deadline ${noticeDeadline} — ${days}. Decide before then${renews}.`;
}
