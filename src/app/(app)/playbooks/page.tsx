import Link from "next/link";
import { BookOpen, TrendingDown, Zap } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listAccountPlaybook } from "@server/application/playbooks";
import { PageHeader } from "@ui/components/shared/page-header";
import { EmptyState } from "@ui/components/shared/empty-state";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { formatCurrency, formatDate } from "@shared/utils";

export const dynamic = "force-dynamic";

const RATIONALE_LABEL: Record<string, string> = {
  cost_reduction: "Cost reduction",
  low_usage: "Low usage",
  no_longer_needed: "No longer needed",
  found_alternative: "Found alternative",
  consolidation: "Tool consolidation",
  missing_features: "Missing features",
  poor_performance: "Poor performance",
  support_issues: "Support issues",
  strategic_pivot: "Strategic pivot",
  security_concern: "Security concern",
  compliance_concern: "Compliance concern",
};

const LEVER_LABEL: Record<string, string> = {
  multi_year_commit: "Multi-year commit",
  competing_quote: "Competing quote",
  volume_increase: "Volume increase",
  payment_terms: "Payment terms",
  consolidated_with_other_products: "Bundled",
  executive_escalation: "Exec escalation",
  threatened_cancellation: "Threatened cancellation",
};

const KIND_LABEL: Record<string, string> = {
  cancelled: "Cancelled",
  downgraded: "Downgraded",
  renegotiated: "Renegotiated",
  avoided_increase: "Avoided increase",
};

/**
 * Decision Playbooks — the team's negotiation memory.
 *
 * Every prior decision that produced savings, with the vendor, lever
 * used, rationale, and dollars achieved. A new renewal owner can browse
 * what worked before and reuse the play. This is the per-account moat
 * — the data accumulates with usage and a competitor without it gives
 * generic advice.
 *
 * Cross-account anonymized benchmarks (P5.4) are the network-effects
 * complement and live on the decide-now + vendor pages.
 */
export default async function PlaybooksPage() {
  const { account } = await getCurrentAccountAndUser();
  const entries = await listAccountPlaybook(account.id, { limit: 200 });

  const totalSaved = entries.reduce((s, e) => s + e.savedAnnualUsdCents, 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader>
        <PageHeader.Title>Decision playbooks</PageHeader.Title>
        <PageHeader.Description>
          What worked. Every prior decision that produced savings, with the
          lever and rationale. The next renewal owner doesn't start from
          scratch.
        </PageHeader.Description>
      </PageHeader>

      {entries.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-8 w-8" />}
          title="No plays yet"
          description="As you log cancellations, downgrades, or renegotiations, they'll appear here as reusable plays."
          action={
            <Link
              href="/notice-deadlines"
              className="text-sm underline underline-offset-4"
            >
              Go to notice deadlines →
            </Link>
          }
        />
      ) : (
        <>
          {/* Hero stat */}
          <Card>
            <CardContent className="py-5 flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-green-50 text-green-700">
                <TrendingDown className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Cumulative savings across {entries.length} play
                  {entries.length === 1 ? "" : "s"}
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(totalSaved)}
                  <span className="text-sm text-muted-foreground font-normal ml-2">
                    / year
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Plays — one card per decision */}
          <div className="grid grid-cols-1 gap-3">
            {entries.map((e) => (
              <Card key={e.id}>
                <CardContent className="py-4 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {e.vendorName}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          — {e.productName}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {KIND_LABEL[e.kind] ?? e.kind}
                        {e.decisionAt && ` · ${formatDate(e.decisionAt)}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-semibold text-green-700 tabular-nums">
                        {formatCurrency(e.savedAnnualUsdCents)}/yr
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatCurrency(e.baselineAnnualUsdCents)} →{" "}
                        {formatCurrency(e.newAnnualUsdCents)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {e.negotiationLever && (
                      <Badge
                        variant="outline"
                        className="bg-primary-soft/30 text-primary-strong border-primary/20 text-xs"
                      >
                        <Zap className="h-3 w-3 mr-1 inline" />
                        {LEVER_LABEL[e.negotiationLever] ?? e.negotiationLever}
                      </Badge>
                    )}
                    {e.rationaleCodes.map((code) => (
                      <Badge
                        key={code}
                        variant="secondary"
                        className="text-xs"
                      >
                        {RATIONALE_LABEL[code] ?? code}
                      </Badge>
                    ))}
                  </div>

                  {e.alternativesConsidered && (
                    <div className="text-xs text-muted-foreground border-t pt-2 mt-1">
                      <span className="font-medium">Alternatives:</span>{" "}
                      {e.alternativesConsidered}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-xs text-muted-foreground italic">
            Plays are operator notes — not legal advice or a guarantee of
            future outcomes.
          </p>
        </>
      )}
    </div>
  );
}
