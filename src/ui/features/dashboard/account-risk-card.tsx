import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AIInsightCard } from "@ui/components/shared/ai-insight-card";
import type { AccountRiskSummary } from "@server/application/account-risk";
import { formatCurrency } from "@shared/utils";

/**
 * Account-risk insight — the live replacement for the old "coming soon"
 * placeholder. Narrates the single biggest renewal risk (via the existing
 * explainRisk surface) over a band distribution. Advisory only: it points where
 * to look; the human decides.
 */
export function AccountRiskCard({ summary }: { summary: AccountRiskSummary }) {
  if (summary.total === 0 || !summary.insight) return null;
  const { insight, topAtRisk } = summary;

  return (
    <AIInsightCard title="Your biggest renewal risk" meta={insight.meta}>
      <div className="flex flex-wrap items-center gap-2">
        <RiskChip label="High" count={summary.highCount} tone="high" />
        <RiskChip label="Medium" count={summary.mediumCount} tone="medium" />
        <RiskChip label="Low" count={summary.lowCount} tone="low" />
      </div>

      <p className="font-medium text-foreground">{insight.headline}</p>
      <p className="text-foreground/90">{insight.rationale}</p>

      {insight.suggestedActions.length > 0 && (
        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
          {insight.suggestedActions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}

      {topAtRisk && (
        <Link
          href={`/subscriptions/${topAtRisk.subscriptionId}`}
          className="inline-flex items-center gap-1.5 text-sm text-indigo-700 hover:text-indigo-900 underline-offset-2 hover:underline"
        >
          Review {topAtRisk.vendorName} — {topAtRisk.productName} (
          {formatCurrency(topAtRisk.annualValueCents)}/yr)
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </AIInsightCard>
  );
}

function RiskChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "high" | "medium" | "low";
}) {
  const cls =
    tone === "high"
      ? "bg-red-100 text-red-700"
      : tone === "medium"
        ? "bg-amber-100 text-amber-800"
        : "bg-green-100 text-green-800";
  return (
    <span
      className={`text-xs uppercase tracking-wide rounded px-2 py-0.5 font-semibold tabular-nums ${cls}`}
    >
      {count} {label}
    </span>
  );
}
