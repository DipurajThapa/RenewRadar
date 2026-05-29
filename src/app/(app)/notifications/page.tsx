import Link from "next/link";
import { Bell, AlertCircle, CheckCircle2, Clock, Mail, MessageSquare } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listNotificationsForUser } from "@server/infrastructure/db/repositories/notifications";
import { PageHeader } from "@ui/components/shared/page-header";
import { EmptyState } from "@ui/components/shared/empty-state";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { formatDate } from "@shared/utils";

export const dynamic = "force-dynamic";

const TRIGGER_LABELS: Record<string, string> = {
  notice_window_30: "30 days to notice deadline",
  notice_window_14: "14 days to notice deadline",
  notice_window_7: "7 days to notice deadline",
  notice_window_3: "3 days to notice deadline",
  notice_window_1: "1 day to notice deadline",
  renewal_90: "90 days to renewal",
  renewal_60: "60 days to renewal",
  renewal_30: "30 days to renewal",
  renewal_14: "14 days to renewal",
  renewal_7: "7 days to renewal",
  renewal_1: "1 day to renewal",
  weekly_digest: "Weekly digest",
  monthly_summary: "Monthly summary",
};

/**
 * Notifications inbox — every alert the system tried to send the user.
 *
 * Replaces the bell dropdown's "See all" target. Surfaces FAILED sends
 * explicitly with an amber badge so admins notice when email delivery is
 * broken (audit P2 friction item — failures were silent in
 * `notificationsTable.status='failed'` rows).
 */
export default async function NotificationsInboxPage() {
  const { account, user } = await getCurrentAccountAndUser();
  const notifications = await listNotificationsForUser(account.id, user.id, {
    limit: 200,
  });

  const sent = notifications.filter((n) => n.status === "sent");
  const failed = notifications.filter((n) => n.status === "failed");
  const queued = notifications.filter((n) => n.status === "queued");

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader>
        <PageHeader.Title>Notifications</PageHeader.Title>
        <PageHeader.Description>
          Every alert the system tried to send you. Failed sends are
          surfaced so admins can spot delivery problems.
        </PageHeader.Description>
      </PageHeader>

      {failed.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-amber-900">
                {failed.length} delivery failure{failed.length === 1 ? "" : "s"}
              </div>
              <p className="text-sm text-amber-800 mt-1">
                Check the email integration secret and DNS records, or
                contact support if the failures continue.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3 text-sm">
        <StatPill icon={<CheckCircle2 className="h-4 w-4" />} label="Sent" value={sent.length} tone="positive" />
        <StatPill icon={<Clock className="h-4 w-4" />} label="Queued" value={queued.length} tone="neutral" />
        <StatPill icon={<AlertCircle className="h-4 w-4" />} label="Failed" value={failed.length} tone={failed.length > 0 ? "warning" : "neutral"} />
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-8 w-8" />}
          title="No notifications yet"
          description="As renewals approach their notice deadlines, alerts will appear here."
        />
      ) : (
        <ul className="divide-y border rounded-md bg-white">
          {notifications.map((n) => (
            <li key={n.id} className="px-4 py-3 text-sm">
              <div className="flex items-start gap-3">
                <ChannelIcon channel={n.channel} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">
                      {TRIGGER_LABELS[n.trigger] ?? n.trigger}
                    </span>
                    <StatusBadge status={n.status} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {n.vendorName && n.productName ? (
                      <Link
                        href={`/subscriptions/${n.entityId ?? ""}`}
                        className="hover:underline"
                      >
                        {n.vendorName} — {n.productName}
                      </Link>
                    ) : (
                      <span className="capitalize">{n.entityType ?? "account"}</span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground text-right tabular-nums shrink-0">
                  {formatDate(n.createdAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "positive" | "warning" | "neutral";
}) {
  const cls =
    tone === "positive"
      ? "bg-green-50 text-green-900 border-green-200"
      : tone === "warning"
        ? "bg-amber-50 text-amber-900 border-amber-200"
        : "bg-muted/30 text-foreground border-border/60";
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "email") {
    return <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />;
  }
  if (channel === "in_app") {
    return <Bell className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />;
  }
  return (
    <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "sent"
      ? "bg-green-50 text-green-900 border-green-200"
      : status === "failed"
        ? "bg-red-50 text-red-900 border-red-200"
        : "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <Badge variant="outline" className={`text-xs capitalize ${className}`}>
      {status}
    </Badge>
  );
}
