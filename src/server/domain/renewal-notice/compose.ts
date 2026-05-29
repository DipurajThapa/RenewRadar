/**
 * A3 — compose a safe-agent INTERNAL renewal notice. Pure + deterministic (no
 * DB, no clock, no LLM): the same brief + terms always produce the same memo.
 *
 * The output is an INTERNAL memo to the procurement owner/team — a heads-up that
 * a renewal decision is due, with Renewal Radar's recommendation and the hard
 * deadline. It is NEVER addressed to the vendor and contains no "send to vendor"
 * framing. That's the binding advisor-not-agent line (dents pain #2 without
 * crossing it): Renewal Radar drafts the internal note; a human still owns every
 * outbound vendor contact.
 */
import { calculateNoticeDeadline } from "@server/domain/notice-deadline/calculate";

export type ComposeNoticeInput = {
  vendorName: string;
  productName: string;
  termEndDate: string; // YYYY-MM-DD
  noticePeriodDays: number;
  annualValueCents: number;
  autoRenew: boolean;
  /** From the brief. */
  recommendedAction: string;
  headline: string;
  confidencePct: number;
  /** Supporting one-liners (brief claim statements), in order. */
  points: string[];
};

export type ComposedNotice = { subject: string; bodyText: string };

const ACTION_PHRASE: Record<string, string> = {
  renewed: "renew as-is",
  renewed_with_adjustments: "renew, but renegotiate first",
  downgraded: "downgrade at renewal",
  cancelled: "cancel before the deadline",
  deferred: "defer / seek a short extension",
};

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function composeInternalNotice(input: ComposeNoticeInput): ComposedNotice {
  // calculateNoticeDeadline returns a Date; format to YYYY-MM-DD (UTC) for a
  // clean, deterministic memo line.
  const noticeDeadline = calculateNoticeDeadline(
    input.termEndDate,
    input.noticePeriodDays
  )
    .toISOString()
    .slice(0, 10);
  const action = ACTION_PHRASE[input.recommendedAction] ?? input.recommendedAction;

  const subject = `Internal renewal notice — ${input.vendorName} ${input.productName} — action by ${noticeDeadline}`;

  const pointsBlock =
    input.points.length > 0
      ? input.points.map((p) => `  • ${p}`).join("\n")
      : "  • (No additional signals — generate a Renewal Intelligence Brief for detail.)";

  const bodyText = `INTERNAL MEMO — for the renewal owner / procurement team
(Not for the vendor. A human sends any external communication.)

Subject: ${input.vendorName} — ${input.productName} renewal decision due

Recommendation: ${action} (confidence ${input.confidencePct}%).
${input.headline}

Key facts:
  • Annualized value: ${dollars(input.annualValueCents)}
  • Notice deadline: ${noticeDeadline} (give notice by this date)
  • Auto-renew: ${input.autoRenew ? "ON — it renews by default unless someone acts" : "off"}

Why:
${pointsBlock}

Next step:
  • Decide and, if renegotiating or cancelling, contact ${input.vendorName} BEFORE ${noticeDeadline}.
  • Renewal Radar prepared this internal note; it does not contact vendors on your behalf.

— Prepared by Renewal Radar. Not legal advice; review against the contract's specific notice clause (form, recipient, timing).`;

  return { subject, bodyText };
}
