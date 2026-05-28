import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { Avatar, AvatarFallback } from "@ui/components/primitives/avatar";
import { formatRelativeDate } from "@shared/utils";
import type { ActivityEntry } from "@server/infrastructure/db/repositories/dashboard";

export function RecentActivity({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {entries.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const description = describeAction(entry.action);
  const href = entityHref(entry);
  const initials = (entry.actorName ?? entry.actorEmail ?? "??")
    .slice(0, 2)
    .toUpperCase();

  const content = (
    <div className="flex items-center gap-3 py-2 px-2 -mx-2 hover:bg-muted/30 rounded-md transition-colors">
      <Avatar className="h-7 w-7">
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">
          <span className="font-medium">
            {entry.actorName ?? entry.actorEmail ?? "System"}
          </span>{" "}
          {description}
        </p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatRelativeDate(entry.createdAt)}
      </span>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {content}
    </Link>
  ) : (
    <div>{content}</div>
  );
}

function describeAction(action: string): string {
  switch (action) {
    case "subscription.created":
      return "added a subscription";
    case "subscription.updated":
      return "edited a subscription";
    case "subscription.cancelled":
      return "cancelled a subscription";
    case "renewal_decision.logged":
      return "logged a renewal decision";
    default:
      return action.replace(/_/g, " ").replace(/\./g, " — ");
  }
}

function entityHref(entry: ActivityEntry): string | null {
  if (entry.targetEntityType === "subscription" && entry.targetEntityId) {
    return `/subscriptions/${entry.targetEntityId}`;
  }
  return null;
}
