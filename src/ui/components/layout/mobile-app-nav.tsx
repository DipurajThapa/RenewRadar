"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Plug,
  Quote,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { MobileNavSheet } from "@ui/components/layout/mobile-nav-sheet";
import { cn } from "@shared/utils";

/**
 * Mobile-only app drawer. Mirrors the desktop SideNav grouping so the user
 * gets the same mental model on small screens.
 *
 * Implementation note: we duplicate the group data here rather than sharing
 * with `side-nav.tsx` because the two surfaces need different active-state
 * styling, different padding, and have different a11y semantics. Trying to
 * share leads to one component with five "this only applies in mobile" flags.
 * The two lists MUST stay in sync, though — adding a destination to one
 * means adding it to the other.
 */

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badgeKey?: "pendingRequests" | "vendorUpdates" | "spendReview";
};

const GROUPS: ReadonlyArray<{ label: string; items: readonly NavItem[] }> = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/action-queue", label: "Action queue", icon: ListChecks },
    ],
  },
  {
    label: "Workflow",
    items: [
      { href: "/review-queue", label: "Review queue", icon: Quote },
      { href: "/approvals", label: "Approvals", icon: ShieldCheck },
      {
        href: "/requests",
        label: "Requests",
        icon: ClipboardList,
        badgeKey: "pendingRequests",
      },
      {
        href: "/spend",
        label: "Spend feed",
        icon: Plug,
        badgeKey: "spendReview",
      },
      {
        href: "/vendor-updates",
        label: "Vendor updates",
        icon: Megaphone,
        badgeKey: "vendorUpdates",
      },
      { href: "/notice-deadlines", label: "Notice deadlines", icon: AlertTriangle },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/documents", label: "Contracts", icon: FileText },
      { href: "/subscriptions", label: "Subscriptions", icon: Inbox },
      { href: "/vendors", label: "Vendors", icon: Building2 },
      { href: "/renewals", label: "Renewals", icon: CalendarDays },
    ],
  },
  {
    label: "Insight",
    items: [{ href: "/reports", label: "Reports", icon: BarChart3 }],
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

export function MobileAppNav({
  pendingRequestCount = 0,
  vendorUpdateCount = 0,
  spendReviewCount = 0,
}: {
  pendingRequestCount?: number;
  vendorUpdateCount?: number;
  spendReviewCount?: number;
}) {
  const pathname = usePathname();
  const counts = {
    pendingRequests: pendingRequestCount,
    vendorUpdates: vendorUpdateCount,
    spendReview: spendReviewCount,
  };

  return (
    <MobileNavSheet
      triggerLabel="Open navigation"
      // App sidebar appears at md+; the hamburger covers phones only.
      triggerClassName="md:hidden"
    >
      <div className="space-y-5">
        {GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            <div className="px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-1">
              {group.label}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              const badgeCount = item.badgeKey ? counts[item.badgeKey] : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-base transition-colors",
                    active
                      ? "bg-primary/10 text-primary-strong font-medium"
                      : "text-foreground/85 hover:bg-secondary"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  {item.label}
                  {badgeCount > 0 && (
                    <span
                      className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground tabular-nums"
                      aria-label={`${badgeCount} pending`}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </MobileNavSheet>
  );
}
