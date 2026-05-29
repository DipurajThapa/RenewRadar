import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import { notFound } from "next/navigation";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  getVendor,
  getVendorIntelligence,
  listVendorEvents,
} from "@server/infrastructure/db/repositories/vendor-memory";
import { listComplianceArtifactsForVendor } from "@server/infrastructure/db/repositories/compliance";
import { getInsightProvider } from "@server/infrastructure/ai";
import { getVendorBenchmark } from "@server/application/vendor-benchmarks";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { AIInsightCard } from "@ui/components/shared/ai-insight-card";
import { VendorBenchmarkCard } from "@ui/components/shared/vendor-benchmark-card";
import { formatCurrency, formatDate } from "@shared/utils";
import {
  RATIONALE_LABEL,
  NEGOTIATION_LEVER_LABEL,
} from "@server/domain/vendor-memory/event-labels";
import { VendorTimeline } from "@ui/features/vendor-memory/vendor-timeline";
import { ComplianceArtifactsCard } from "@ui/features/vendor-memory/compliance-artifacts-card";
import { VendorConnectionCard } from "@ui/features/vendor-memory/vendor-connection-card";
import { findMatchingVendorOrg } from "@server/application/vendor-portal/connections";

export const dynamic = "force-dynamic";

export default async function VendorIntelligencePage({
  params,
}: {
  params: { id: string };
}) {
  const { account } = await getCurrentAccountAndUser();
  const vendor = await getVendor(account.id, params.id);
  if (!vendor) notFound();

  const [intelligence, events, artifacts, benchmark] = await Promise.all([
    getVendorIntelligence(account.id, vendor.id),
    listVendorEvents(account.id, vendor.id, { limit: 200 }),
    listComplianceArtifactsForVendor(account.id, vendor.id),
    getVendorBenchmark(vendor.name).catch((err) => {
      console.error("[vendors/[id]] benchmark failed:", err);
      return null;
    }),
  ]);

  // T4.10 Slice 3 — does a verified vendor_org match this vendor?
  const connectionMatch = await findMatchingVendorOrg({
    accountId: account.id,
    customerVendorId: vendor.id,
  }).catch(() => null);

  const histogramSorted = Object.entries(intelligence.rationaleHistogram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Rough "years tracked" from the oldest vendor event. Heuristic — good
  // enough for the AI narrative without an extra query.
  const oldestEvent = events[events.length - 1];
  const yearsTracked = oldestEvent
    ? Math.max(
        0,
        (Date.now() - new Date(oldestEvent.occurredAt).getTime()) /
          (365.25 * 24 * 60 * 60 * 1000)
      )
    : 0;

  const expiringComplianceCount = artifacts.filter((a) => {
    if (!a.expiresAt) return false;
    const days =
      (new Date(a.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    return days >= 0 && days <= 60;
  }).length;

  const lastDecision = intelligence.lastDecisions[0];
  let aiSummary: Awaited<
    ReturnType<
      ReturnType<typeof getInsightProvider>["summarizeVendorIntelligence"]
    >
  > | null = null;
  try {
    const ai = getInsightProvider();
    aiSummary = await ai.summarizeVendorIntelligence({
      vendorName: vendor.name,
      yearsTracked,
      activeSubscriptions: intelligence.subscriptionCount,
      cancelledSubscriptions: intelligence.lastDecisions.filter(
        (d) => d.decision === "cancelled"
      ).length,
      totalSavedAnnualCents: intelligence.totalSavingsLifetimeCents,
      averagePriceChangePct: intelligence.averagePriceChangePct,
      lastDecisionLabel: lastDecision?.decision ?? null,
      lastDecisionDate:
        lastDecision?.decisionAt
          ? formatDate(lastDecision.decisionAt)
          : null,
      complianceArtifacts: artifacts.length,
      expiringComplianceArtifacts: expiringComplianceCount,
    });
  } catch (err) {
    console.error("[vendors/[id]] summarizeVendorIntelligence failed:", err);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <Link
          href="/vendors"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          All vendors
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{vendor.name}</h1>
        {vendor.website && (
          <p className="text-sm text-muted-foreground mt-1">
            <a
              href={vendor.website}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {vendor.website}
            </a>
          </p>
        )}
      </header>

      {connectionMatch && (
        <VendorConnectionCard
          customerVendorId={vendor.id}
          vendorOrgId={connectionMatch.vendorOrg.id}
          vendorDisplayName={connectionMatch.vendorOrg.displayName}
          matchedBy={connectionMatch.matchedBy}
          status={connectionMatch.connection?.status ?? "none"}
        />
      )}

      {aiSummary && (
        <AIInsightCard
          title="Vendor intelligence"
          meta={aiSummary.meta}
        >
          <p className="text-foreground">{aiSummary.summary}</p>
          {aiSummary.highlights.length > 0 && (
            <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
              {aiSummary.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </AIInsightCard>
      )}

      {/* Cross-account benchmark — only renders when at least 3 customers
          share this vendor. Network-effects moat. */}
      {benchmark && (
        <VendorBenchmarkCard
          vendorDisplayName={vendor.name}
          benchmark={benchmark}
        />
      )}

      {/* Intelligence summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Annualized spend
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-1">
              {formatCurrency(intelligence.totalSpendLifetimeCents)}
            </div>
            <div className="text-xs text-muted-foreground">
              across {intelligence.subscriptionCount} subscription
              {intelligence.subscriptionCount === 1 ? "" : "s"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Saved with this vendor
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-1 text-green-700">
              {formatCurrency(intelligence.totalSavingsLifetimeCents)}
            </div>
            <div className="text-xs text-muted-foreground">
              {intelligence.decisionCount} decision
              {intelligence.decisionCount === 1 ? "" : "s"} logged
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Avg price change
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-1 flex items-center gap-1">
              {intelligence.averagePriceChangePct === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  {intelligence.averagePriceChangePct > 0 ? (
                    <TrendingUp className="h-5 w-5 text-amber-700" />
                  ) : intelligence.averagePriceChangePct < 0 ? (
                    <TrendingDown className="h-5 w-5 text-green-700" />
                  ) : null}
                  {intelligence.averagePriceChangePct > 0 ? "+" : ""}
                  {intelligence.averagePriceChangePct.toFixed(1)}%
                </>
              )}
            </div>
            <div className="text-xs text-muted-foreground">per recorded change</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Most cited reasons
            </div>
            <div className="space-y-1 mt-2">
              {histogramSorted.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No rationale captured yet.
                </div>
              ) : (
                histogramSorted.map(([code, n]) => (
                  <div
                    key={code}
                    className="flex items-center justify-between text-xs"
                  >
                    <span>{RATIONALE_LABEL[code] ?? code}</span>
                    <span className="text-muted-foreground tabular-nums">
                      ×{n}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last decisions per subscription */}
      {intelligence.lastDecisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What we did last time</CardTitle>
            <p className="text-xs text-muted-foreground">
              The most recent decision per subscription with this vendor — for
              answering &ldquo;what did we do last time?&rdquo; years from now.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {intelligence.lastDecisions.map((d) => (
              <div
                key={d.subscriptionId}
                className="flex items-start justify-between gap-3 border-b last:border-0 pb-3 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/subscriptions/${d.subscriptionId}`}
                    className="font-medium hover:underline"
                  >
                    {d.productName}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {d.decisionAt && formatDate(d.decisionAt)}
                  </div>
                  {d.rationaleCodes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {d.rationaleCodes.map((c) => (
                        <Badge key={c} variant="secondary" className="text-xs">
                          {RATIONALE_LABEL[c] ?? c}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {d.negotiationLever && d.negotiationLever !== "none" && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Lever:{" "}
                      <strong>
                        {NEGOTIATION_LEVER_LABEL[d.negotiationLever] ??
                          d.negotiationLever}
                      </strong>
                    </div>
                  )}
                </div>
                <Badge variant="outline" className="capitalize shrink-0">
                  {d.decision.replace(/_/g, " ")}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Compliance */}
      <ComplianceArtifactsCard vendorId={vendor.id} artifacts={artifacts} />

      {/* Full timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every recorded event in the relationship with {vendor.name}.
            Append-only. Survives team turnover.
          </p>
        </CardHeader>
        <CardContent>
          <VendorTimeline events={events} />
        </CardContent>
      </Card>
    </div>
  );
}
