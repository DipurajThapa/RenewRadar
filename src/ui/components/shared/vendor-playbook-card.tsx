import { History } from "lucide-react";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { formatCurrency, formatDate } from "@shared/utils";

/**
 * Per-account "last time you decided this vendor" card.
 *
 * The moat is per-account: the team can see what they did last renewal
 * with this vendor — decision, lever, savings — and reuse the playbook
 * instead of starting from scratch. The audit's "make decision_context
 * data useful" gap.
 *
 * Shown on decide-now and the vendor detail page when there's at least
 * one prior decision. Render-only; no side effects.
 */
export type LastDecisionForCard = {
  vendorName: string;
  productName: string;
  decision: string;
  decisionAt: Date | string | null;
  rationaleCodes: string[];
  negotiationLever: string | null;
  savedAnnualUsdCents: number | null;
};

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
  team_change: "Team change",
  vendor_acquired: "Vendor acquired",
  price_too_high: "Price too high",
};

const LEVER_LABEL: Record<string, string> = {
  multi_year_commit: "Multi-year commitment",
  competing_quote: "Competing quote",
  volume_increase: "Volume increase",
  payment_terms: "Payment terms",
  consolidated_with_other_products: "Bundled with other products",
  executive_escalation: "Executive escalation",
  threatened_cancellation: "Threatened cancellation",
  other: "Other",
};

export function VendorPlaybookCard({
  lastDecision,
}: {
  lastDecision: LastDecisionForCard;
}) {
  const decisionLabel = lastDecision.decision.replace(/_/g, " ");
  const dateStr = lastDecision.decisionAt
    ? formatDate(
        typeof lastDecision.decisionAt === "string"
          ? new Date(lastDecision.decisionAt)
          : lastDecision.decisionAt
      )
    : null;

  return (
    <Card className="border-foreground/15 bg-foreground/[0.02]">
      <CardContent className="py-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-foreground/10 text-foreground">
            <History className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              What you did last time with {lastDecision.vendorName}
            </div>
            <div className="text-sm font-medium mt-0.5">
              {lastDecision.productName}
            </div>
          </div>
          {dateStr && (
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className="capitalize">{decisionLabel}</Badge>
          {lastDecision.savedAnnualUsdCents !== null &&
            lastDecision.savedAnnualUsdCents > 0 && (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-900 border-green-200"
              >
                Saved {formatCurrency(lastDecision.savedAnnualUsdCents)}/yr
              </Badge>
            )}
          {lastDecision.negotiationLever &&
            lastDecision.negotiationLever !== "none" && (
              <Badge variant="outline">
                Lever:{" "}
                {LEVER_LABEL[lastDecision.negotiationLever] ??
                  lastDecision.negotiationLever}
              </Badge>
            )}
        </div>

        {lastDecision.rationaleCodes.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              Cited reasons
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lastDecision.rationaleCodes.map((code) => (
                <Badge key={code} variant="secondary" className="text-xs">
                  {RATIONALE_LABEL[code] ?? code}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground italic">
          Past decisions are operator notes — not legal advice or a
          guarantee of future outcomes.
        </p>
      </CardContent>
    </Card>
  );
}
