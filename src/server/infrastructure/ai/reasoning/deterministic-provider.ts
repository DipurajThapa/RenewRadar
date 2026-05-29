/**
 * Deterministic Renewal Intelligence engine — the default, offline, genuine
 * multi-signal reasoner. No randomness, no clock dependence (today arrives via
 * `daysUntilNoticeDeadline`), so tests assert verbatim.
 *
 * Why this beats a spreadsheet cell: six inference passes are RESOLVED AGAINST
 * EACH OTHER — the recommendation is a function of trajectory × benchmark ×
 * urgency × leverage × BATNA, not any single column — plus a next-renewal
 * prediction from the account's own price history, every claim carrying its
 * evidence. No cell does cross-signal resolution + regression + evidence.
 */
import type {
  BriefClaim,
  BriefEvidence,
  ChargePoint,
  RecommendedAction,
  RenewalBriefInput,
  RenewalIntelligenceBrief,
  ReasoningProvider,
} from "./types";
import { validateBrief } from "./validate";

const LEVER_LABEL: Record<string, string> = {
  competing_quote: "anchor with a competing quote",
  multi_year_commit: "trade a multi-year commit for a price hold",
  volume_discount: "ask for a volume discount",
  threatened_cancellation: "signal willingness to walk",
  downgrade_tier: "right-size the tier",
  remove_seats: "right-size seats",
  none: "negotiate the renewal",
};

function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000
  );
}

/** Ordinary least squares over (x days, y annualized cents). Returns slope,
 *  intercept, and R². */
function ols(points: Array<{ x: number; y: number }>) {
  const n = points.length;
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    const pred = slope * p.x + intercept;
    ssTot += (p.y - my) ** 2;
    ssRes += (p.y - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

function trajectoryPass(input: RenewalBriefInput): {
  claim: BriefClaim | null;
  prediction: RenewalIntelligenceBrief["predictedNextAnnualCents"];
  rising: boolean;
} {
  const pts = input.chargeHistory;
  if (pts.length < 2) {
    return { claim: null, prediction: null, rising: false };
  }
  const t0 = pts[0]!.effectiveDate;
  const xy = pts.map((p: ChargePoint) => ({
    x: daysBetween(t0, p.effectiveDate),
    y: p.totalAnnualizedCents,
  }));
  const { slope, intercept, r2 } = ols(xy);
  const xEnd = daysBetween(t0, input.termEndDate);
  const point = Math.max(0, Math.round(slope * xEnd + intercept));
  const first = pts[0]!.totalAnnualizedCents;
  const last = pts[pts.length - 1]!.totalAnnualizedCents;
  const deltaPct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  const bandFrac = Math.max(0.08, 1 - r2); // wider band when fit is poor
  const prediction = {
    point,
    low: Math.round(point * (1 - bandFrac)),
    high: Math.round(point * (1 + bandFrac)),
  };
  const rising = slope > 0 && deltaPct >= 3;
  const conf = clampInt(60 + Math.min(pts.length - 2, 3) * 7 + r2 * 12, 0, 92);
  const trend =
    deltaPct > 2
      ? `rose ${deltaPct}%`
      : deltaPct < -2
        ? `fell ${Math.abs(deltaPct)}%`
        : "held roughly flat";
  return {
    claim: {
      key: "price_trajectory",
      statement: `Annualized cost ${trend} from ${usd(first)} to ${usd(last)} over ${pts.length} observed charges. Projected next renewal ≈ ${usd(point)} (range ${usd(prediction.low)}–${usd(prediction.high)}).`,
      engine: "deterministic",
      confidencePct: conf,
      evidence: [
        {
          source: "charge_history",
          detail: `${pts.length} charge points; first ${pts[0]!.effectiveDate} (${usd(first)}/yr), latest ${pts[pts.length - 1]!.effectiveDate} (${usd(last)}/yr).`,
          quote: null,
          refId: pts[pts.length - 1]!.refId,
        },
      ],
    },
    prediction,
    rising,
  };
}

function benchmarkPass(input: RenewalBriefInput): {
  claim: BriefClaim | null;
  aboveMedian: boolean | null;
} {
  const b = input.benchmark;
  if (!b || b.medianAnnualValueCents == null || b.sampleAccounts < 3) {
    return { claim: null, aboveMedian: null };
  }
  const median = b.medianAnnualValueCents;
  const ratio = median > 0 ? input.annualValueCents / median : 1;
  const pct = Math.round((ratio - 1) * 100);
  const aboveMedian = pct > 0;
  const where =
    Math.abs(pct) <= 5
      ? "in line with"
      : `${Math.abs(pct)}% ${pct > 0 ? "above" : "below"}`;
  return {
    aboveMedian,
    claim: {
      key: "benchmark_position",
      statement: `At ${usd(input.annualValueCents)}/yr you're ${where} the cross-account median (${usd(median)}/yr) across ${b.sampleAccounts} accounts tracking ${input.vendorName}, including yours.`,
      engine: "deterministic",
      confidencePct: b.sampleAccounts >= 5 ? 80 : 65,
      evidence: [
        {
          source: "benchmark",
          detail: `Median ${usd(median)}/yr over ${b.sampleAccounts} accounts; auto-renew seen on ${b.autoRenewRatePct ?? "n/a"}% of them.`,
          quote: null,
          refId: null,
        },
      ],
    },
  };
}

function urgencyPass(input: RenewalBriefInput): {
  claim: BriefClaim;
  level: "missed" | "high" | "medium" | "low";
} {
  const d = input.daysUntilNoticeDeadline;
  const level: "missed" | "high" | "medium" | "low" = input.noticeDeadlineMissed
    ? "missed"
    : d <= 14
      ? "high"
      : d <= 30
        ? "medium"
        : "low";
  const evidence: BriefEvidence[] = [
    {
      source: "notice_deadline",
      detail: input.noticeDeadlineMissed
        ? "Notice window already missed."
        : `${d} days until the notice deadline.`,
      quote: null,
      refId: null,
    },
  ];
  if (input.autoRenew) {
    evidence.push({
      source: "auto_renew_flag",
      detail: "Auto-renew is ON — it renews by default unless you act.",
      quote: null,
      refId: null,
    });
  }
  if (input.hasPriceIncreaseClause && input.priceIncreaseClauseText) {
    evidence.push({
      source: "price_increase_clause",
      detail: "Contract carries a price-increase clause.",
      quote: input.priceIncreaseClauseText.slice(0, 300),
      refId: null,
    });
  }
  const conf =
    level === "missed" ? 95 : level === "high" ? 88 : level === "medium" ? 72 : 60;
  const statement = input.noticeDeadlineMissed
    ? `Notice window has passed — this will auto-renew unless the vendor allows a late exit.`
    : `${d} days to the notice deadline${input.autoRenew ? ", and auto-renew is on" : ""}${input.hasPriceIncreaseClause ? "; a price-increase clause is present" : ""}.`;
  return {
    level,
    claim: {
      key: "renewal_risk",
      statement,
      engine: "deterministic",
      confidencePct: conf,
      evidence,
    },
  };
}

function leveragePass(
  input: RenewalBriefInput,
  rising: boolean,
  aboveMedian: boolean | null
): BriefClaim | null {
  const levers: string[] = [];
  const evidence: BriefEvidence[] = [];

  if (rising && input.hasPriceIncreaseClause) {
    levers.push("challenge the uplift clause before it compounds");
  }
  const b = input.benchmark;
  if (b && b.topLevers.length > 0) {
    const top = b.topLevers[0]!;
    levers.push(LEVER_LABEL[top.lever] ?? top.lever.replace(/_/g, " "));
    evidence.push({
      source: "benchmark",
      detail: `Other accounts on ${input.vendorName} most often used "${top.lever}" (${top.count}×).`,
      quote: null,
      refId: null,
    });
  }
  const ownWin = input.priorDecisions.find(
    (d) => d.negotiationLever && d.negotiationLever !== "none" && (d.savedAnnualUsdCents ?? 0) > 0
  );
  if (ownWin) {
    levers.push(
      `repeat your "${ownWin.negotiationLever}" play (${usd(ownWin.savedAnnualUsdCents ?? 0)} saved last time)`
    );
    evidence.push({
      source: "prior_decision",
      detail: `You previously saved ${usd(ownWin.savedAnnualUsdCents ?? 0)}/yr on ${input.vendorName} via ${ownWin.negotiationLever}.`,
      quote: null,
      refId: null,
    });
  }
  if (aboveMedian) {
    levers.push("cite the cross-account median to push for parity");
  }

  if (levers.length === 0 || evidence.length === 0) return null;
  return {
    key: "leverage",
    statement: `Negotiation levers: ${levers.slice(0, 3).join("; ")}.`,
    engine: "deterministic",
    confidencePct: evidence.length >= 2 ? 78 : 66,
    evidence,
  };
}

function batnaPass(
  input: RenewalBriefInput,
  prediction: RenewalIntelligenceBrief["predictedNextAnnualCents"]
): BriefClaim | null {
  const b = input.benchmark;
  const ownWalk = input.priorDecisions.find(
    (d) => d.decision === "cancelled" || d.decision === "downgraded"
  );
  const credibleAlt =
    Boolean(ownWalk) ||
    Boolean(b && b.medianSavingsAnnualCents && b.medianSavingsAnnualCents > 0);

  if (input.autoRenew && !input.noticeDeadlineMissed && credibleAlt) {
    const floor = Math.max(
      ownWalk?.savedAnnualUsdCents ?? 0,
      b?.medianSavingsAnnualCents ?? 0
    );
    const evidence: BriefEvidence[] = [];
    if (ownWalk) {
      evidence.push({
        source: "prior_decision",
        detail: `You've previously ${ownWalk.decision} a vendor here — a walk is credible.`,
        quote: null,
        refId: null,
      });
    }
    if (b && b.medianSavingsAnnualCents) {
      evidence.push({
        source: "benchmark",
        detail: `Median realized saving on ${input.vendorName} across accounts: ${usd(b.medianSavingsAnnualCents)}/yr.`,
        quote: null,
        refId: null,
      });
    }
    if (evidence.length === 0) return null;
    return {
      key: "batna",
      statement: `Your walk-away position is strong: downgrade or cancel as the alternative, targeting at least ${usd(floor)}/yr in savings versus the projected renewal.`,
      engine: "deterministic",
      confidencePct: 74,
      evidence,
    };
  }

  // Default BATNA: no-deal cost = the projected renewal.
  if (prediction) {
    return {
      key: "batna",
      statement: `No strong walk-away signal yet — the no-deal cost is the projected renewal of ${usd(prediction.point)}/yr. Build leverage (usage data, a competing quote) before the window closes.`,
      engine: "deterministic",
      confidencePct: 58,
      evidence: [
        {
          source: "charge_history",
          detail: `Projected renewal ${usd(prediction.point)}/yr from your own price history.`,
          quote: null,
          refId: null,
        },
      ],
    };
  }
  return null;
}

function recommend(input: {
  level: "missed" | "high" | "medium" | "low";
  rising: boolean;
  aboveMedian: boolean | null;
  hasClause: boolean;
  hasWalk: boolean;
}): { action: RecommendedAction; confidence: number } {
  if (input.level === "missed") return { action: "deferred", confidence: 90 };

  let action: RecommendedAction;
  if (input.hasWalk && (input.aboveMedian || input.rising)) {
    action = "downgraded";
  } else if ((input.level === "high" || input.rising) && (input.hasClause || input.aboveMedian)) {
    action = "renewed_with_adjustments";
  } else if (input.level === "low" && !input.rising && input.aboveMedian === false) {
    action = "renewed";
  } else {
    action = "renewed_with_adjustments";
  }

  // Cross-signal agreement → confidence. Disagreement lowers it.
  const signals = [input.rising, input.aboveMedian === true, input.hasClause];
  const agree = signals.filter(Boolean).length;
  let confidence = 60 + agree * 8;
  if (input.rising && input.aboveMedian === false) confidence -= 12; // conflict
  if (input.level === "high") confidence += 6;
  return { action, confidence: clampInt(confidence, 40, 90) };
}

export class DeterministicReasoningProvider implements ReasoningProvider {
  readonly providerName = "deterministic-reasoner";
  readonly model = "renewal-reasoner-v1";
  readonly promptVersion = "v1.0";

  async buildBrief(
    input: RenewalBriefInput
  ): Promise<RenewalIntelligenceBrief> {
    const traj = trajectoryPass(input);
    const bench = benchmarkPass(input);
    const urgency = urgencyPass(input);
    const leverage = leveragePass(input, traj.rising, bench.aboveMedian);
    const batna = batnaPass(input, traj.prediction);
    // A downgrade/cancel recommendation requires the customer's OWN prior walk
    // — a benchmark showing others saved strengthens BATNA (the claim) but does
    // not by itself justify recommending a downgrade.
    const strongWalk = input.priorDecisions.some(
      (d) => d.decision === "cancelled" || d.decision === "downgraded"
    );

    const rec = recommend({
      level: urgency.level,
      rising: traj.rising,
      aboveMedian: bench.aboveMedian,
      hasClause: input.hasPriceIncreaseClause,
      hasWalk: strongWalk,
    });

    const recClaim: BriefClaim = {
      key: "recommended_action",
      statement: recommendStatement(rec.action, input),
      engine: "deterministic",
      confidencePct: rec.confidence,
      evidence: [
        {
          source: "notice_deadline",
          detail: `Resolved from urgency (${urgency.level}), trajectory (${traj.rising ? "rising" : "flat"}), benchmark (${bench.aboveMedian == null ? "n/a" : bench.aboveMedian ? "above median" : "at/below median"}).`,
          quote: null,
          refId: null,
        },
      ],
    };

    const claims = [
      traj.claim,
      bench.claim,
      urgency.claim,
      leverage,
      batna,
      recClaim,
    ].filter((c): c is BriefClaim => c != null);

    const brief: RenewalIntelligenceBrief = {
      meta: {
        provider: this.providerName,
        model: this.model,
        promptVersion: this.promptVersion,
        confidencePct: rec.confidence,
        engine: "deterministic",
        briefVersion: "brief-v1",
      },
      headline: "", // recomputed by validateBrief
      recommendedAction: rec.action,
      claims,
      predictedNextAnnualCents: traj.prediction,
    };

    return validateBrief(brief, { clauseText: input.priceIncreaseClauseText });
  }
}

function recommendStatement(
  action: RecommendedAction,
  input: RenewalBriefInput
): string {
  switch (action) {
    case "deferred":
      return `Decide this renewal now — ${input.noticeDeadlineMissed ? "the notice window has passed" : "the window is closing"}. Log a decision so it doesn't auto-renew by inertia.`;
    case "renewed_with_adjustments":
      return `Renew, but renegotiate first — open the conversation before the notice deadline and use the levers below. Renewal Radar drafts the internal notice; you send it.`;
    case "downgraded":
      return `Strong case to downgrade or right-size at renewal given the cost trajectory and your walk-away position.`;
    case "cancelled":
      return `Consider cancelling — the value no longer justifies the spend. Draft the notice now to beat the deadline.`;
    default:
      return `Renew as-is — pricing is reasonable and risk is low. Still log the decision so the record stays complete.`;
  }
}
