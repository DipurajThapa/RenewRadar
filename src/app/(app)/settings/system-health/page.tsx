import { redirect } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Mail,
  Plug,
  Server,
  TrendingUp,
} from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { hasRole } from "@server/middleware/rbac";
import { getSystemHealth } from "@server/application/system-health";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";

export const dynamic = "force-dynamic";

/**
 * Admin-only system health page.
 *
 * Surfaces the "is anything broken?" view that ops needs but a regular
 * member doesn't. Non-admins get redirected to the settings index — no
 * 403 noise. The page is read-only; everything actionable lives on the
 * relevant feature page (notifications, integrations, documents).
 */
export default async function SystemHealthPage() {
  const { account, user } = await getCurrentAccountAndUser();
  if (!hasRole(user, "admin")) {
    redirect("/settings/account");
  }

  const health = await getSystemHealth(account.id, account.planTier);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            System health
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Operational status for this account. The page reads only your data
            — nothing here is cross-tenant.
          </p>
        </div>
        <OverallBadge overall={health.overall} />
      </header>

      {/* Open issues — the only "act now" surface on the page */}
      <Card className={openIssueClass(health.overall)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Open issues
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <IssueStat
            label="Failed extractions (30d)"
            value={health.openIssues.failedExtractions}
          />
          <IssueStat
            label="Notification failures (7d)"
            value={health.openIssues.notificationFailures7d}
          />
          <IssueStat
            label="Docs needing attention"
            value={health.openIssues.documentsNeedingAttention}
          />
        </CardContent>
      </Card>

      {/* Provider snapshot */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Wired providers
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pluggable infrastructure swappable via env vars. Confirms which
            implementation is live right now.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          <ProviderRow label="AI extraction" value={health.providers.aiExtraction} />
          <ProviderRow label="AI insights" value={health.providers.aiInsights} />
          <ProviderRow label="OCR" value={health.providers.ocr} />
          <ProviderRow label="Document storage" value={health.providers.storage} />
          <ProviderRow label="Rate limiter" value={health.providers.rateLimit} />
          <ProviderRow
            label="DB round-trip"
            value={`${health.dbLatencyMs} ms`}
          />
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Notification delivery (last 7 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {health.notifications.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notifications attempted in the last 7 days.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {health.notifications.byChannel.map((c) => (
                <li
                  key={c.channel}
                  className="grid grid-cols-[120px_1fr_auto] gap-3 items-center"
                >
                  <span className="capitalize">{c.channel}</span>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={
                        c.successRatePct === null
                          ? "h-full bg-muted"
                          : c.successRatePct >= 95
                            ? "h-full bg-green-600"
                            : c.successRatePct >= 75
                              ? "h-full bg-amber-500"
                              : "h-full bg-red-500"
                      }
                      style={{
                        width: `${c.successRatePct ?? 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs tabular-nums">
                    {c.sent} sent · {c.failed} failed
                    {c.successRatePct !== null
                      ? ` · ${c.successRatePct}%`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* AI extraction */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            AI extraction (last 30 days)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {health.extractions.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No extractions in the last 30 days.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Total" value={health.extractions.total} />
              <Stat
                label="Succeeded"
                value={health.extractions.succeeded}
                tone="positive"
              />
              <Stat
                label="Failed"
                value={health.extractions.failed}
                tone={health.extractions.failed > 0 ? "warning" : "default"}
              />
              <Stat
                label="Success rate"
                value={
                  health.extractions.successRatePct === null
                    ? "—"
                    : `${health.extractions.successRatePct}%`
                }
              />
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            <TrendingUp className="inline-block h-3 w-3 mr-1" />
            AI pages this month:{" "}
            <strong className="text-foreground">
              {health.aiBudget.usedThisMonth.toLocaleString()}
            </strong>{" "}
            of{" "}
            {health.aiBudget.capIsFinite
              ? health.aiBudget.cap.toLocaleString()
              : "unlimited"}
            {health.aiBudget.percentUsed !== null && (
              <span className="ml-1">
                ({health.aiBudget.percentUsed}% used)
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI serving observability (Phase B/B6) — token usage, cache, spend. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            AI serving
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Reasoning throughput, cache effectiveness, and this account&apos;s
            monthly AI spend vs its tier cap. Process counters reset on restart.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="LLM calls (since boot)" value={health.serving.process.calls.toLocaleString()} />
            <Stat label="Tokens (since boot)" value={health.serving.process.totalTokens.toLocaleString()} />
            <Stat label="Cache hit rate" value={`${health.serving.cache.hitRatePct}%`} />
            <Stat
              label="Reasoning ops this month"
              value={health.serving.reasoning.callsThisMonth.toLocaleString()}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            <TrendingUp className="inline-block h-3 w-3 mr-1" />
            AI reasoning spend this month:{" "}
            <strong className="text-foreground">
              ${(health.serving.reasoning.costThisMonthUsdMicros / 1_000_000).toFixed(4)}
            </strong>{" "}
            of{" "}
            {health.serving.reasoning.capIsFinite
              ? `$${(health.serving.reasoning.capUsdMicros / 1_000_000).toFixed(2)}`
              : "unlimited"}
            {health.serving.reasoning.percentUsed !== null && (
              <span className="ml-1">({health.serving.reasoning.percentUsed}% used)</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Integrations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Integrations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {health.integrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No integrations configured. Connect Slack or rotate an ICS
              token from{" "}
              <a className="underline" href="/settings/integrations">
                Integrations
              </a>
              .
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {health.integrations.map((i) => (
                <li
                  key={i.kind}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="capitalize">
                      {i.kind.replace(/_/g, " ")}
                    </span>
                    {i.enabled ? (
                      <Badge variant="outline" className="bg-green-50 text-green-900 border-green-200">
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Updated{" "}
                    {new Date(i.updatedAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
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

function OverallBadge({
  overall,
}: {
  overall: "healthy" | "degraded" | "critical";
}) {
  if (overall === "healthy") {
    return (
      <Badge
        variant="outline"
        className="bg-green-50 text-green-900 border-green-200 gap-1.5"
      >
        <CheckCircle2 className="h-3 w-3" />
        Healthy
      </Badge>
    );
  }
  if (overall === "degraded") {
    return (
      <Badge
        variant="outline"
        className="bg-amber-50 text-amber-900 border-amber-200 gap-1.5"
      >
        <Activity className="h-3 w-3" />
        Degraded
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-red-50 text-red-900 border-red-200 gap-1.5"
    >
      <AlertTriangle className="h-3 w-3" />
      Critical
    </Badge>
  );
}

function openIssueClass(
  overall: "healthy" | "degraded" | "critical"
): string {
  if (overall === "critical") return "border-red-200 bg-red-50/40";
  if (overall === "degraded") return "border-amber-200 bg-amber-50/40";
  return "";
}

function IssueStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-2xl font-semibold tabular-nums ${
          value > 0 ? "text-red-700" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ProviderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "positive" | "warning";
}) {
  const cls =
    tone === "positive"
      ? "text-green-700"
      : tone === "warning"
        ? "text-red-700"
        : "";
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${cls}`}>
        {value}
      </div>
    </div>
  );
}
