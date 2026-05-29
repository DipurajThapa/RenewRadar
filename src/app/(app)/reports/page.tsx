import Link from "next/link";
import { Download, TrendingDown, AlertTriangle, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { PageHeader } from "@ui/components/shared/page-header";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  getExposureByStatus,
  getMissedDeadlinesByMonth,
} from "@server/infrastructure/db/repositories/reports";
import {
  getRealizedSavingsTotals,
  getSavingsByMonth,
  getSavingsTotals,
  listSavingsForAccount,
} from "@server/infrastructure/db/repositories/savings";
import { BadgeCheck } from "lucide-react";
import { getInsightProvider } from "@server/infrastructure/ai";
import { hasTierFeature } from "@server/domain/billing/tier-features";
import { formatCurrency, formatDate } from "@shared/utils";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  upcoming: "Upcoming",
  notice_window: "In notice window",
  action_needed: "Action needed",
  processed: "Processed",
  missed: "Missed",
};

const SAVINGS_KIND_LABELS: Record<string, string> = {
  cancelled: "Cancellations",
  downgraded: "Downgrades",
  renegotiated: "Renegotiations",
  avoided_increase: "Avoided increases",
};

export default async function ReportsPage() {
  const { account } = await getCurrentAccountAndUser();
  const yearStart = new Date(`${new Date().getUTCFullYear()}-01-01T00:00:00Z`);

  const [
    exposure,
    savingsTotals,
    savingsByMonth,
    recentSavings,
    missedByMonth,
    realizedTotals,
  ] = await Promise.all([
    getExposureByStatus(account.id),
    getSavingsTotals(account.id, { sinceDate: yearStart }),
    getSavingsByMonth(account.id, { sinceDate: yearStart }),
    listSavingsForAccount(account.id, { limit: 10 }),
    getMissedDeadlinesByMonth(account.id, { sinceDate: yearStart }),
    getRealizedSavingsTotals(account.id),
  ]);

  const totalExposureCents = exposure.reduce(
    (sum, e) => sum + e.annualValueCents,
    0
  );
  const totalExposureCount = exposure.reduce((sum, e) => sum + e.count, 0);
  const totalMissedCount = missedByMonth.reduce((sum, m) => sum + m.count, 0);
  const totalMissedValueCents = missedByMonth.reduce(
    (sum, m) => sum + m.annualValueCents,
    0
  );

  // AI savings narratives — one per recent decision. Gated on savingsReports
  // (Growth+) since narratives are part of the paid reports surface. Stubs
  // are deterministic and fast; production swap batches into one request.
  const savingsNarratives: Array<string | null> = hasTierFeature(
    account.planTier,
    "savingsReports"
  )
    ? await (async () => {
        const ai = getInsightProvider();
        return Promise.all(
          recentSavings.map((s) =>
            ai
              .narrateSavings({
                vendorName: s.vendorName,
                productName: s.productName,
                kind: s.kind,
                baselineAnnualUsdCents: s.baselineAnnualUsdCents,
                newAnnualUsdCents: s.newAnnualUsdCents,
                savedAnnualUsdCents: s.savedAnnualUsdCents,
                // Real data from the decision_context — the decide-now form
                // collects these now (P2.3).
                negotiationLever: s.negotiationLever,
                rationaleCodes: s.rationaleCodes,
              })
              .then((r) => r.narrative)
              .catch(() => null)
          )
        );
      })()
    : recentSavings.map(() => null);

  return (
    <div className="space-y-8 max-w-6xl">
      <PageHeader>
        <PageHeader.Title>Reports</PageHeader.Title>
        <PageHeader.Description>
          Year-to-date view of exposure, savings, and missed deadlines. All
          figures annualized.
        </PageHeader.Description>
      </PageHeader>

      {/* Hero metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          icon={<Calendar className="h-4 w-4" />}
          label="Annualized exposure"
          value={formatCurrency(totalExposureCents)}
          sub={`Across ${totalExposureCount} active renewal${
            totalExposureCount === 1 ? "" : "s"
          }`}
        />
        <MetricCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="Saved YTD"
          value={formatCurrency(savingsTotals.totalSavedAnnualUsdCents)}
          sub={`${savingsTotals.recordCount} decision${
            savingsTotals.recordCount === 1 ? "" : "s"
          } logged`}
          tone="positive"
        />
        <MetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Missed deadlines YTD"
          value={String(totalMissedCount)}
          sub={
            totalMissedValueCents > 0
              ? `${formatCurrency(totalMissedValueCents)} auto-renewed`
              : "Clean record"
          }
          tone={totalMissedCount > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Exposure breakdown */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Exposure by renewal status</CardTitle>
          <Link
            href="/api/export/exposure"
            prefetch={false}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <Download className="h-3 w-3" />
            CSV
          </Link>
        </CardHeader>
        <CardContent>
          {exposure.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active renewals to summarize yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {exposure.map((bucket) => (
                <li
                  key={bucket.status}
                  className="grid grid-cols-[120px_1fr_auto] sm:grid-cols-[200px_1fr_auto] gap-4 items-center"
                >
                  <span className="capitalize">
                    {STATUS_LABELS[bucket.status] ?? bucket.status}
                  </span>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-foreground"
                      style={{
                        width: `${
                          totalExposureCents > 0
                            ? (bucket.annualValueCents / totalExposureCents) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-muted-foreground">
                    {bucket.count} · {formatCurrency(bucket.annualValueCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Savings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Savings ledger ({new Date().getUTCFullYear()})</CardTitle>
          <Link
            href="/api/export/savings"
            prefetch={false}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <Download className="h-3 w-3" />
            CSV
          </Link>
        </CardHeader>
        <CardContent className="space-y-6">
          {savingsTotals.recordCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              No decisions logged yet this year. As you cancel, downgrade, or
              renegotiate, savings will land here automatically.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(savingsTotals.byKind).map(([kind, v]) => (
                  <div
                    key={kind}
                    className="rounded-md border p-3 bg-muted/20"
                  >
                    <div className="text-xs text-muted-foreground">
                      {SAVINGS_KIND_LABELS[kind] ?? kind}
                    </div>
                    <div className="text-lg font-semibold mt-1 tabular-nums">
                      {formatCurrency(v.savedAnnualUsdCents)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {v.count} record{v.count === 1 ? "" : "s"}
                    </div>
                  </div>
                ))}
              </div>

              {savingsByMonth.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2">By month</h3>
                  <ul className="space-y-1.5 text-sm">
                    {savingsByMonth.map((m) => (
                      <li
                        key={m.monthKey}
                        className="grid grid-cols-[100px_1fr_auto] gap-3 items-center"
                      >
                        <span className="tabular-nums text-muted-foreground">
                          {m.monthKey}
                        </span>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-green-600"
                            style={{
                              width: `${
                                savingsTotals.totalSavedAnnualUsdCents > 0
                                  ? (m.savedAnnualUsdCents /
                                      savingsTotals.totalSavedAnnualUsdCents) *
                                    100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <span className="tabular-nums">
                          {formatCurrency(m.savedAnnualUsdCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium mb-2">Recent decisions</h3>
                <ul className="divide-y border rounded-md bg-white">
                  {recentSavings.map((s, i) => (
                    <li
                      key={s.id}
                      className="px-3 py-2 text-sm space-y-1"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">
                            {s.vendorName} — {s.productName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {SAVINGS_KIND_LABELS[s.kind] ?? s.kind} ·{" "}
                            {formatDate(s.createdAt)}
                          </div>
                        </div>
                        <div className="text-right tabular-nums">
                          <div className="text-green-700 font-medium">
                            {formatCurrency(s.savedAnnualUsdCents)}/yr
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {s.isLocked ? "Locked" : "Editable"}
                          </div>
                        </div>
                      </div>
                      {savingsNarratives[i] && (
                        <div className="text-xs text-muted-foreground italic pl-0.5">
                          ✦ {savingsNarratives[i]}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Realized vs projected savings (A2 — the ROI loop) */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-green-600" />
          <CardTitle>Realized vs projected savings</CardTitle>
        </CardHeader>
        <CardContent>
          {realizedTotals.projectedSavedAnnualUsdCents === 0 ? (
            <p className="text-sm text-muted-foreground">
              No savings logged yet. Once you log a renewal decision, Renewal
              Radar reconciles the projected saving against your actual
              post-renewal spend — proving what really stuck.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-md border p-3 bg-muted/20">
                  <div className="text-xs text-muted-foreground">
                    Projected savings
                  </div>
                  <div className="text-2xl font-semibold tabular-nums mt-1">
                    {formatCurrency(realizedTotals.projectedSavedAnnualUsdCents)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    What the decisions aimed to save
                  </div>
                </div>
                <div className="rounded-md border p-3 bg-green-50/50">
                  <div className="text-xs text-muted-foreground">
                    Proven savings (reconciled)
                  </div>
                  <div className="text-2xl font-semibold tabular-nums mt-1 text-green-700">
                    {formatCurrency(realizedTotals.realizedSavedAnnualUsdCents)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Confirmed against actual post-renewal spend
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5">
                  {realizedTotals.realizedCount} matched projection
                </span>
                {realizedTotals.varianceCount > 0 && (
                  <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                    {realizedTotals.varianceCount} variance
                  </span>
                )}
                <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                  {realizedTotals.awaitingCount} awaiting first post-renewal charge
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground border-t pt-2">
                Reconciliation runs daily off your auto-ingested spend feed —
                Renewal Radar only records what actually happened; it never
                changes a price or contacts a vendor.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Missed deadlines */}
      <Card>
        <CardHeader>
          <CardTitle>Missed deadlines ({new Date().getUTCFullYear()})</CardTitle>
        </CardHeader>
        <CardContent>
          {missedByMonth.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No missed deadlines this year — clean record.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {missedByMonth.map((m) => (
                <li
                  key={m.monthKey}
                  className="grid grid-cols-[100px_1fr_auto] gap-3 items-center"
                >
                  <span className="tabular-nums text-muted-foreground">
                    {m.monthKey}
                  </span>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-red-500"
                      style={{
                        width: `${
                          totalMissedValueCents > 0
                            ? (m.annualValueCents / totalMissedValueCents) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span className="tabular-nums">
                    {m.count} · {formatCurrency(m.annualValueCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  const valueClass =
    tone === "positive"
      ? "text-green-700"
      : tone === "warning"
        ? "text-red-700"
        : "";
  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          {icon}
          {label}
        </div>
        <div className={`text-3xl font-semibold tabular-nums mt-2 ${valueClass}`}>
          {value}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}
