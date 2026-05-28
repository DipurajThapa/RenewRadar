import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { NotificationBell } from "@/components/layout/notification-bell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  countUnreadInAppNotifications,
  listRecentInAppNotifications,
} from "@/lib/db/queries/notifications";
import type { Account, User } from "@/lib/db/schema";
import { isDemoMode } from "@/lib/demo-mode";

export async function TopNav({
  account,
  user,
}: {
  account: Account;
  user: User;
}) {
  const [unread, recent] = await Promise.all([
    countUnreadInAppNotifications(account.id, user.id).catch(() => 0),
    listRecentInAppNotifications(account.id, user.id, 15).catch(() => []),
  ]);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-4 min-w-0">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-semibold shrink-0"
        >
          <span aria-hidden>⚡</span>
          <span className="hidden sm:inline">Renewal Radar</span>
        </Link>
        <span className="text-sm text-muted-foreground hidden md:inline truncate">
          {account.name}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <NotificationBell unreadCount={unread} notifications={recent} />
        {isDemoMode ? <DemoUserBadge user={user} /> : <UserButton afterSignOutUrl="/" />}
      </div>
    </header>
  );
}

function DemoUserBadge({ user }: { user: User }) {
  const initials = (user.fullName ?? user.workEmail).slice(0, 2).toUpperCase();
  return (
    <Avatar
      className="h-8 w-8 ml-1"
      title={`${user.fullName ?? user.workEmail} (demo)`}
    >
      <AvatarFallback className="text-xs bg-amber-200 text-amber-900">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
