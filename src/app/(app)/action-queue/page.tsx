import Link from "next/link";
import { Banknote, ListChecks } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  listActionQueueRows,
  rollupActionQueue,
} from "@server/infrastructure/db/repositories/action-queue";
import { getInsightProvider } from "@server/infrastructure/ai";
import { hasTierFeature } from "@server/domain/billing/tier-features";
import { ActionQueueTable } from "@ui/features/action-queue/queue-table";
import { EmptyState } from "@ui/components/shared/empty-state";
import { PageHeader } from "@ui/components/shared/page-header";
import { StatCard } from "@ui/components/shared/stat-card";
import { AIInsightCard } from "@ui/components/shared/ai-insight-card";
import { Button } from "@ui/components/primitives/button";
import { formatCurrency } from "@shared/utils";

export const dynamic = "force-dynamic";

/**
 * Action queue — the cross-subscription "what to do next" view.
 *
 * Lists every renewal event in notice_window / action_needed / missed or
 * within 60 days of its notice deadline, scored by `lib/risk/score.ts` and
 * sorted by (missed-first, band, earliest-deadline).
 *
 * The user clicks a row → Decide-Now flow for that renewal.
 *
 * AI surface: the top-ranked row gets an AI-generated explanation card that
 * tells the operator *why* this is the most urgent thing on the list. The
 * heuristic stub returns deterministic copy in dev; the production swap is
 * Claude Sonnet.
 */
export default async function ActionQueuePage() {
  const { account } = await getCurrentAccountAndUser();
  const rows = await listActionQueueRows(account.id);
  const rollup = rollupActionQueue(rows);

  // Top-row AI insight — only when there's something worth explaining AND
  // the account's tier includes the action-queue feature. Free Forever
  // accounts shouldn't reach this page in normal navigation, but if they do
  // we skip the AI call so we don't burn provider tokens.
  let topInsight: Awaited<
    ReturnType<ReturnType<typeof getInsightProvider>["explainRisk"]>
  > | null = null;
  const top = rows[0];
  if (top && hasTierFeature(account.planTier, "actionQueue")) {
    try {
      const ai = getInsightProvider();
      topInsight = await ai.explainRisk({
        riskScore: top.risk.score,
        riskBand: top.risk.band,
        components: {
          // Repository doesn't expose components today; back-fill rough
          // estimates so the heuristic narrative stays deterministic. The
          // production swap will receive the full components from the
          // domain layer (a thin repo extension is queued in tests).
          urgency: top.risk.score >= 60 ? 50 : top.risk.score >= 35 ? 25 : 5,
          value: Math.min(25, Math.floor(top.annualValueCents / 100 / 10000)),
          clausePressure:
            (top.autoRenew ? 10 : 0) + (top.status === "missed" ? 5 : 0),
        },
        daysUntilNoticeDeadline: top.daysUntilNoticeDeadline,
        annualValueCents: top.annualValueCents,
        autoRenew: top.autoRenew,
        isMissed: top.status === "missed",
        vendorName: top.vendorName,
        productName: top.productName,
      });
    } catch (err) {
      // AI insights are non-essential — log and degrade silently.
      console.error("[action-queue] explainRisk failed:", err);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeader.Title>Action queue</PageHeader.Title>
        <PageHeader.Description>
          Renewals that need a decision soon, ranked by composite risk —
          urgency × value × auto-renew.
        </PageHeader.Description>
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="You're all clear"
          description="No renewals need attention in the next 60 days. New ones will appear here as their notice deadlines approach."
          variant="success"
          action={
            <Button asChild variant="outline">
              <Link href="/subscriptions">View all subscriptions</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              tone={rollup.high > 0 ? "primary" : "default"}
              label="High risk"
              value={rollup.high.toString()}
              sublabel={rollup.high === 1 ? "renewal" : "renewals"}
            />
            <StatCard
              label="Medium risk"
              value={rollup.medium.toString()}
              sublabel={rollup.medium === 1 ? "renewal" : "renewals"}
            />
            <StatCard
              label="Low risk"
              value={rollup.low.toString()}
              sublabel={rollup.low === 1 ? "renewal" : "renewals"}
            />
            <StatCard
              label="At stake · per year"
              value={formatCurrency(rollup.totalAnnualValueAtRiskCents)}
              icon={<Banknote />}
              sublabel="Annualized exposure"
            />
          </div>

          {topInsight && top && (
            <AIInsightCard
              title={`Top of queue · ${top.vendorName}`}
              meta={topInsight.meta}
            >
              <div className="font-medium text-foreground">
                {topInsight.headline}
              </div>
              <p className="text-muted-foreground">{topInsight.rationale}</p>
              {topInsight.suggestedActions.length > 0 && (
                <ul className="list-disc list-inside text-muted-foreground space-y-0.5 pt-1">
                  {topInsight.suggestedActions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              )}
              <div className="pt-1">
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/subscriptions/${top.subscriptionId}/decide?event=${top.renewalEventId}`}
                  >
                    Decide now →
                  </Link>
                </Button>
              </div>
            </AIInsightCard>
          )}

          <ActionQueueTable rows={rows} />
        </>
      )}
    </div>
  );
}
