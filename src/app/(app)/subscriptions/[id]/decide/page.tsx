import Link from "next/link";
import { ArrowLeft, TrendingDown } from "lucide-react";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { Badge } from "@ui/components/primitives/badge";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { getRenewalEventWithContext } from "@server/infrastructure/db/repositories/renewals";
import { getSavingsForRenewalEvent } from "@server/infrastructure/db/repositories/savings";
import { getLatestBrief } from "@server/application/renewal-brief";
import type { RenewalIntelligenceBrief } from "@server/infrastructure/ai/reasoning/types";
import { hasTierFeature } from "@server/domain/billing/tier-features";
import { getVendorIntelligence } from "@server/infrastructure/db/repositories/vendor-memory";
import { getVendorBenchmark } from "@server/application/vendor-benchmarks";
import { DecideNowHeader } from "@ui/features/decide-now/header";
import { DecideNowFacts } from "@ui/features/decide-now/facts";
import { DecideNowForm } from "@ui/features/decide-now/form";
import { RenewalBriefCard } from "@ui/features/renewal-brief/renewal-brief-card";
import { VendorPlaybookCard } from "@ui/components/shared/vendor-playbook-card";
import { VendorBenchmarkCard } from "@ui/components/shared/vendor-benchmark-card";
import { formatCurrency, formatDate } from "@shared/utils";
import { annualizeCents } from "@server/domain/billing/annualize";
import type { SavingsRow } from "@server/infrastructure/db/repositories/savings";

type Props = {
  params: { id: string };
  searchParams: { event?: string };
};

export const dynamic = "force-dynamic";

export default async function DecideNowPage({ params, searchParams }: Props) {
  const { account, user } = await getCurrentAccountAndUser();

  if (!searchParams.event) {
    notFound();
  }

  const data = await getRenewalEventWithContext(account.id, searchParams.event);

  if (!data || data.subscription.id !== params.id) {
    notFound();
  }

  // If the decision is already logged, show a read-only summary instead of the form
  if (data.renewalEvent.decision) {
    const savings = await getSavingsForRenewalEvent(
      account.id,
      data.renewalEvent.id
    );
    return (
      <AlreadyDecided
        subscriptionId={data.subscription.id}
        vendorName={data.vendor.name}
        productName={data.subscription.productName}
        decision={data.renewalEvent.decision}
        decisionAt={data.renewalEvent.decisionAt}
        decisionNote={data.renewalEvent.decisionNote}
        savings={savings}
      />
    );
  }

  const annualValueCents = annualizeCents(
    data.subscription.totalCostPerPeriodCents,
    data.subscription.billingCycle
  );

  // Per-account playbook: the team's previous decision on this vendor.
  // Reuses `getVendorIntelligence` which already pulls the last decision
  // per subscription + rationale + lever. We pick the most recent entry
  // that ISN'T the current renewal (current would be misleading — it's
  // the one we're about to decide).
  const vendorIntel = await getVendorIntelligence(
    account.id,
    data.subscription.vendorId
  );
  const lastDecisionOnVendor = vendorIntel.lastDecisions.find(
    (d) => d.subscriptionId !== data.subscription.id
  );

  // Cross-account benchmark — the network-effects moat. Returns null
  // when N < MIN_BENCHMARK_SAMPLE, in which case we render nothing.
  const benchmark = await getVendorBenchmark(data.vendor.name).catch(
    (err) => {
      console.error("[decide] vendor benchmark failed:", err);
      return null;
    }
  );

  // AI-first single source of truth: the Renewal Intelligence Brief is the ONLY
  // reasoning surface on this page. Unlike the retired heuristic recommender
  // (which emitted a verdict with no receipts), every brief claim carries its
  // evidence, per-claim provenance (`deterministic` | `llm`), and a confidence
  // score — satisfying the no-hallucination bar. The decide-form prefill and
  // the recommendation card both read from this one object.
  const latestBriefRow = await getLatestBrief(account.id, data.subscription.id);
  const brief =
    (latestBriefRow?.briefJson as RenewalIntelligenceBrief | null) ?? null;
  const briefGeneratedAt = latestBriefRow
    ? formatDate(latestBriefRow.createdAt)
    : null;
  const canGenerateBrief = hasTierFeature(account.planTier, "renewalBrief");

  // Map the brief's evidence-bound recommendation onto the decide-form's
  // four-way decision enum. "deferred" has no decision equivalent (it means
  // "not enough signal yet"), so we leave the form unprefilled rather than
  // guess — the AI prepares, the human decides.
  const formSuggestion =
    brief && brief.recommendedAction !== "deferred"
      ? {
          decision: brief.recommendedAction as
            | "renewed"
            | "renewed_with_adjustments"
            | "downgraded"
            | "cancelled",
          decisionLabel: brief.recommendedAction.replace(/_/g, " "),
          // The brief output doesn't expose a structured lever list; the
          // cross-account benchmark card (rendered above) is the
          // evidence-grounded lever source, so we don't fabricate one here.
          suggestedLever: null,
          rationaleCodes: [] as string[],
        }
      : undefined;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/notice-deadlines"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to notice deadlines
        </Link>
      </div>

      <DecideNowHeader
        vendorName={data.vendor.name}
        productName={data.subscription.productName}
        noticeDeadline={data.renewalEvent.noticeDeadline}
        annualValueCents={annualValueCents}
      />

      {/* Per-account playbook — what you did last time on this vendor.
          This is the per-account moat: vendor memory put to use. */}
      {lastDecisionOnVendor && (
        <VendorPlaybookCard
          lastDecision={{
            vendorName: data.vendor.name,
            productName: lastDecisionOnVendor.productName,
            decision: lastDecisionOnVendor.decision,
            decisionAt: lastDecisionOnVendor.decisionAt,
            rationaleCodes: lastDecisionOnVendor.rationaleCodes,
            negotiationLever: lastDecisionOnVendor.negotiationLever,
            savedAnnualUsdCents: null, // joined separately on the vendor page
          }}
        />
      )}

      {/* Cross-account benchmark — the network-effects moat. Only renders
          when at least MIN_BENCHMARK_SAMPLE customers share this vendor. */}
      {benchmark && (
        <VendorBenchmarkCard
          vendorDisplayName={data.vendor.name}
          benchmark={benchmark}
        />
      )}

      {/* The Renewal Intelligence Brief — one evidence-backed reasoning
          surface, identical to the one on the subscription detail page. It
          shows the recommended action with per-claim provenance + confidence,
          and lets the user generate/regenerate it on demand. */}
      {(brief || canGenerateBrief) && (
        <RenewalBriefCard
          subscriptionId={data.subscription.id}
          brief={brief}
          generatedAt={briefGeneratedAt}
          canGenerate={canGenerateBrief}
        />
      )}

      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="py-4 text-sm text-amber-900">
          <strong>The stakes:</strong> If you do nothing,{" "}
          {data.vendor.name} auto-renews on{" "}
          {formatDate(data.subscription.termEndDate)} for{" "}
          ${(annualValueCents / 100).toLocaleString("en-US")} per year. The
          notice deadline is the last day you can prevent that.
        </CardContent>
      </Card>

      <DecideNowFacts
        subscription={data.subscription}
        vendor={data.vendor}
      />

      <DecideNowForm
        renewalEventId={data.renewalEvent.id}
        subscriptionId={data.subscription.id}
        currentTotalSeats={data.subscription.totalSeats}
        currentUnitPriceCents={data.subscription.unitPriceCents}
        vendorName={data.vendor.name}
        productName={data.subscription.productName}
        termEndDate={data.subscription.termEndDate}
        vendorCancellationEmail={data.vendor.cancellationEmail}
        vendorCancellationUrl={data.vendor.cancellationUrl}
        defaultCustomerName={user.fullName ?? undefined}
        defaultCompanyName={account.name}
        suggestion={formSuggestion}
      />
    </div>
  );
}

function AlreadyDecided({
  subscriptionId,
  vendorName,
  productName,
  decision,
  decisionAt,
  decisionNote,
  savings,
}: {
  subscriptionId: string;
  vendorName: string;
  productName: string;
  decision: string;
  decisionAt: Date | null;
  decisionNote: string | null;
  savings: SavingsRow | null;
}) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/notice-deadlines"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to notice deadlines
        </Link>
      </div>

      <div>
        <p className="text-sm text-muted-foreground">{vendorName}</p>
        <h1 className="text-2xl font-semibold mt-1">{productName}</h1>
      </div>

      <Card>
        <CardContent className="py-6 space-y-3">
          <div className="flex items-center gap-2">
            <Badge className="capitalize">{decision.replace(/_/g, " ")}</Badge>
            {decisionAt && (
              <span className="text-sm text-muted-foreground">
                logged {formatDate(decisionAt)}
              </span>
            )}
          </div>
          <p className="text-sm">
            You've already logged a decision for this renewal. Future
            notice-deadline alerts for it are suppressed.
          </p>
          {decisionNote && (
            <div className="pt-3 border-t">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Decision note
              </div>
              <p className="text-sm whitespace-pre-wrap">{decisionNote}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {savings && savings.savedAnnualUsdCents > 0 && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="py-5 space-y-2">
            <div className="flex items-center gap-2 text-green-900">
              <TrendingDown className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wide">
                Saved
              </span>
            </div>
            <div className="text-3xl font-bold text-green-900 tabular-nums">
              {formatCurrency(savings.savedAnnualUsdCents)}
              <span className="text-sm text-green-700 font-normal ml-2">
                / year
              </span>
            </div>
            <div className="text-xs text-green-800">
              Baseline {formatCurrency(savings.baselineAnnualUsdCents)} →{" "}
              {formatCurrency(savings.newAnnualUsdCents)} after this decision.
              {savings.isLocked
                ? " This entry is locked."
                : " Editable for 30 days from the decision date."}
            </div>
            <div className="text-xs text-green-700 pt-1">
              Counts toward your savings ledger in{" "}
              <Link href="/reports" className="underline underline-offset-4">
                Reports
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      )}

      <Button asChild variant="outline">
        <Link href={`/subscriptions/${subscriptionId}`}>
          View subscription detail →
        </Link>
      </Button>
    </div>
  );
}

// annualizeCents now lives in @server/domain/billing/annualize
