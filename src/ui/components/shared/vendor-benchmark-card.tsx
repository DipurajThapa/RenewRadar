import { TrendingDown, Users, Zap } from "lucide-react";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { formatCurrency } from "@shared/utils";
import type { VendorBenchmark } from "@server/application/vendor-benchmarks";

const RATIONALE_LABEL: Record<string, string> = {
  cost_reduction: "Cost reduction",
  low_usage: "Low usage",
  no_longer_needed: "No longer needed",
  found_alternative: "Found alternative",
  consolidation: "Tool consolidation",
  missing_features: "Missing features",
  poor_performance: "Poor performance",
  support_issues: "Support issues",
};

const LEVER_LABEL: Record<string, string> = {
  multi_year_commit: "Multi-year commitment",
  competing_quote: "Competing quote",
  volume_increase: "Volume increase",
  payment_terms: "Payment terms",
  consolidated_with_other_products: "Bundled with other products",
  executive_escalation: "Executive escalation",
  threatened_cancellation: "Threatened cancellation",
};

/**
 * Cross-account vendor benchmark card.
 *
 * Surfaces anonymized patterns from every customer who has the same
 * vendor. Only renders when the privacy floor (N ≥ MIN_BENCHMARK_SAMPLE)
 * is satisfied — the aggregator returns null otherwise and the caller
 * should skip rendering. This is the network-effects moat: a Vendr /
 * Tropic / Sastrify competitor without this data layer is stuck giving
 * generic advice.
 *
 * NEVER shows specific customer names, contract values for individual
 * accounts, or any field that could re-identify a single customer.
 */
export function VendorBenchmarkCard({
  vendorDisplayName,
  benchmark,
}: {
  vendorDisplayName: string;
  benchmark: VendorBenchmark;
}) {
  return (
    <Card className="border-primary/15 bg-primary-soft/30">
      <CardContent className="py-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground shrink-0">
            <Users className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              How other customers handle {vendorDisplayName}
            </div>
            <div className="text-sm font-medium mt-0.5">
              Anonymized aggregate from {benchmark.sampleAccounts} customer
              {benchmark.sampleAccounts === 1 ? "" : "s"} (
              {benchmark.sampleSubscriptions} subscription
              {benchmark.sampleSubscriptions === 1 ? "" : "s"})
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {benchmark.typicalNoticePeriodDays !== null && (
            <BenchmarkStat
              label="Typical notice"
              value={`${benchmark.typicalNoticePeriodDays} days`}
            />
          )}
          {benchmark.autoRenewRatePct !== null && (
            <BenchmarkStat
              label="Auto-renew rate"
              value={`${benchmark.autoRenewRatePct}%`}
              tone={
                benchmark.autoRenewRatePct >= 75 ? "warning" : "default"
              }
            />
          )}
          {benchmark.medianAnnualValueCents !== null && (
            <BenchmarkStat
              label="Median value"
              value={`${formatCurrency(benchmark.medianAnnualValueCents)}/yr`}
            />
          )}
        </div>

        {benchmark.topLevers.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5 inline-flex items-center gap-1">
              <Zap className="h-3 w-3" />
              Levers customers reach for
            </div>
            <div className="flex flex-wrap gap-1.5">
              {benchmark.topLevers.map((l) => (
                <Badge
                  key={l.lever}
                  variant="outline"
                  className="text-xs"
                >
                  {LEVER_LABEL[l.lever] ?? l.lever} · {l.count}×
                </Badge>
              ))}
            </div>
          </div>
        )}

        {benchmark.topRationaleCodes.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              Most-cited reasons
            </div>
            <div className="flex flex-wrap gap-1.5">
              {benchmark.topRationaleCodes.map((r) => (
                <Badge
                  key={r.code}
                  variant="secondary"
                  className="text-xs"
                >
                  {RATIONALE_LABEL[r.code] ?? r.code} · {r.count}×
                </Badge>
              ))}
            </div>
          </div>
        )}

        {benchmark.medianSavingsAnnualCents !== null &&
          benchmark.medianSavingsAnnualCents > 0 && (
            <div className="flex items-center gap-2 text-sm border-t pt-3">
              <TrendingDown className="h-4 w-4 text-green-700" />
              <span>
                Customers who renegotiated saved a median of{" "}
                <strong>
                  {formatCurrency(benchmark.medianSavingsAnnualCents)}/yr
                </strong>{" "}
                on this vendor.
              </span>
            </div>
          )}

        <p className="text-xs text-muted-foreground italic">
          Anonymized aggregate — no specific customer or contract is
          disclosed. Patterns only; not legal advice or a guarantee of
          outcomes.
        </p>
      </CardContent>
    </Card>
  );
}

function BenchmarkStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-lg font-semibold tabular-nums mt-1 ${
          tone === "warning" ? "text-amber-800" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
