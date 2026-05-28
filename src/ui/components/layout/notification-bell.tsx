"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Inbox } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@ui/components/primitives/dropdown-menu";
import { cn } from "@shared/utils";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@app/(app)/notifications/actions";
import {
  notificationDestinationUrl,
  notificationTriggerLabel,
} from "@server/domain/notifications/labels";
import type { InAppNotificationRow } from "@server/infrastructure/db/repositories/notifications";

type Props = {
  unreadCount: number;
  notifications: InAppNotificationRow[];
};

/**
 * Notification bell + dropdown feed.
 *
 * Rules:
 *   - Badge shows current unread count (0 → hidden).
 *   - Clicking a row marks that single notification as read AND navigates to
 *     its destination. We use a server action wrapped in a transition so the
 *     mark-read fires while the navigation is mid-flight.
 *   - "Mark all read" empties the badge without navigating.
 *   - The empty state ("You're caught up") shows when there's nothing queued
 *     OR delivered in the recent window. That intentionally surfaces the
 *     non-empty "no unread, but here's what you've seen recently" case too —
 *     users can re-read context after marking through.
 */
export function NotificationBell({ unreadCount, notifications }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const queuedCount = notifications.filter((n) => n.status === "queued").length;

  function handleRowClick(row: InAppNotificationRow) {
    const dest = notificationDestinationUrl(
      row.trigger,
      row.entityType,
      row.entityId
    );
    setOpen(false);
    if (row.status === "queued") {
      startTransition(async () => {
        await markNotificationReadAction(row.id);
        router.push(dest);
        router.refresh();
      });
    } else {
      router.push(dest);
    }
  }

  function handleMarkAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
          aria-label={`${unreadCount} unread notifications`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-semibold">Notifications</div>
          {queuedCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={pending}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Check className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <EmptyFeed />
        ) : (
          <ul className="max-h-[420px] overflow-y-auto divide-y">
            {notifications.map((n) => (
              <li key={n.id}>
                <NotificationRow
                  row={n}
                  pending={pending}
                  onClick={() => handleRowClick(n)}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="border-t px-3 py-2 text-xs">
          <Link
            href="/settings/notifications"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            Notification settings →
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({
  row,
  pending,
  onClick,
}: {
  row: InAppNotificationRow;
  pending: boolean;
  onClick: () => void;
}) {
  const unread = row.status === "queued";
  const title = notificationTriggerLabel(row.trigger);
  const subtitle =
    row.vendorName && row.productName
      ? `${row.vendorName} — ${row.productName}`
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        "w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors flex items-start gap-2 disabled:opacity-50"
      )}
    >
      <span
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          unread ? "bg-blue-500" : "bg-transparent"
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", unread && "font-medium")}>{title}</div>
        {subtitle && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {subtitle}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground mt-1">
          {timeAgo(row.createdAt)}
        </div>
      </div>
    </button>
  );
}

function EmptyFeed() {
  return (
    <div className="px-3 py-10 text-center text-sm text-muted-foreground">
      <Inbox className="mx-auto h-6 w-6 mb-2 opacity-60" />
      You're caught up.
    </div>
  );
}

function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}
