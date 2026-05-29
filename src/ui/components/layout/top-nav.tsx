import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Zap } from "lucide-react";
import { NotificationBell } from "@ui/components/layout/notification-bell";
import { Avatar, AvatarFallback } from "@ui/components/primitives/avatar";
import { Badge } from "@ui/components/primitives/badge";
import { MobileAppNav } from "@ui/components/layout/mobile-app-nav";
import {
  countUnreadInAppNotifications,
  listRecentInAppNotifications,
} from "@server/infrastructure/db/repositories/notifications";
import type { Account, User } from "@server/infrastructure/db/schema";
import { isDemoMode } from "@server/middleware/demo-mode";

/**
 * App-shell top bar.
 *
 * Mobile (< md):  shows a hamburger that opens the side-nav as a drawer +
 *                 the brand block, since the sidebar isn't visible.
 * Desktop:        shows the current account context (with optional "Demo"
 *                 pill) on the left, bell + user on the right. Brand lives
 *                 in the sidebar.
 */
export async function TopNav({
  account,
  user,
  pendingRequestCount = 0,
  vendorUpdateCount = 0,
  spendReviewCount = 0,
}: {
  account: Account;
  user: User;
  /** Forwarded to the mobile nav so the badges match the sidebar. */
  pendingRequestCount?: number;
  vendorUpdateCount?: number;
  spendReviewCount?: number;
}) {
  const [unread, recent] = await Promise.all([
    countUnreadInAppNotifications(account.id, user.id).catch(() => 0),
    listRecentInAppNotifications(account.id, user.id, 15).catch(() => []),
  ]);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 px-4 sm:px-6 md:px-8">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile hamburger — opens the side-nav as a drawer */}
        <MobileAppNav
          pendingRequestCount={pendingRequestCount}
          vendorUpdateCount={vendorUpdateCount}
          spendReviewCount={spendReviewCount}
        />

        {/* Mobile-only brand */}
        <Link
          href="/dashboard"
          className="md:hidden flex items-center gap-2 font-semibold shrink-0"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Zap className="h-3.5 w-3.5" />
          </span>
          <span className="font-display tracking-tight">Renewal Radar</span>
        </Link>

        <div className="hidden md:flex items-center gap-2.5 min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Account
          </div>
          <div className="text-sm font-medium text-foreground truncate max-w-[280px]">
            {account.name}
          </div>
          {isDemoMode && (
            <Badge
              variant="warning-soft"
              className="text-[10px] uppercase tracking-[0.12em]"
            >
              Demo
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <NotificationBell unreadCount={unread} notifications={recent} />
        <div className="h-6 w-px bg-border mx-1 hidden sm:block" />
        {isDemoMode ? <DemoUserBadge user={user} /> : <UserButton afterSignOutUrl="/" />}
      </div>
    </header>
  );
}

function DemoUserBadge({ user }: { user: User }) {
  const initials = (user.fullName ?? user.workEmail).slice(0, 2).toUpperCase();
  return (
    <Avatar
      className="h-9 w-9 ring-2 ring-primary/10"
      title={`${user.fullName ?? user.workEmail} (demo)`}
    >
      <AvatarFallback className="text-xs bg-primary-soft text-primary-strong font-semibold">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
