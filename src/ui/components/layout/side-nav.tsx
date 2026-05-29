"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
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
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@shared/utils";

/**
 * Grouped sidebar. Sections collect related destinations so the user's eye
 * doesn't have to scan 10 unstructured links to find the right one.
 *
 *   Overview  — the dashboard and the daily action surface
 *   Workflow  — the queues that drive day-to-day operation
 *   Library   — the long-lived data: contracts, subscriptions, calendar
 *   Insight   — reports + anomalies + future ML/analytics surfaces
 *   System    — settings (always last, always pinned at the bottom)
 *
 * The active state uses a tinted background + a left accent bar, which reads
 * cleanly in peripheral vision without dominating the surface.
 */

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Short blurb shown to screenreaders for richer context. */
  description?: string;
  /**
   * When set, the count of dynamic items keyed to this nav entry. The layout
   * resolves the number and passes it in via the `counts` map so this client
   * component stays presentational.
   */
  badgeKey?: "pendingRequests" | "vendorUpdates" | "spendReview";
};

type NavGroup = { label: string; items: readonly NavItem[] };

const GROUPS: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        description: "What needs your attention today",
      },
      {
        href: "/action-queue",
        label: "Action queue",
        icon: ListChecks,
        description: "Pending decisions, ranked by urgency",
      },
    ],
  },
  {
    label: "Workflow",
    items: [
      {
        href: "/review-queue",
        label: "Review queue",
        icon: Quote,
        description: "Accept, edit, or reject AI-extracted fields",
      },
      {
        href: "/approvals",
        label: "Approvals",
        icon: ShieldCheck,
        description: "Decisions awaiting a second pair of eyes",
      },
      {
        href: "/requests",
        label: "Requests",
        icon: ClipboardList,
        description: "Procurement intake: who wants to start paying for what",
        badgeKey: "pendingRequests",
      },
      {
        href: "/spend",
        label: "Spend feed",
        icon: Plug,
        description: "Auto-detect subscriptions from card/expense activity",
        badgeKey: "spendReview",
      },
      {
        href: "/vendor-updates",
        label: "Vendor updates",
        icon: Megaphone,
        description: "Price changes & renewal notices from connected vendors",
        badgeKey: "vendorUpdates",
      },
      {
        href: "/notice-deadlines",
        label: "Notice deadlines",
        icon: AlertTriangle,
        description: "Upcoming windows to opt out",
      },
    ],
  },
  {
    label: "Library",
    items: [
      {
        href: "/documents",
        label: "Contracts",
        icon: FileText,
        description: "Uploaded PDFs, DOCX, and spreadsheets",
      },
      {
        href: "/subscriptions",
        label: "Subscriptions",
        icon: Inbox,
        description: "Every tracked SaaS subscription",
      },
      {
        href: "/vendors",
        label: "Vendors",
        icon: Building2,
        description: "Per-vendor intelligence and timelines",
      },
      {
        href: "/renewals",
        label: "Renewals",
        icon: CalendarDays,
        description: "12-month renewal calendar",
      },
    ],
  },
  {
    label: "Insight",
    items: [
      {
        href: "/reports",
        label: "Reports",
        icon: BarChart3,
        description: "Exposure, savings, missed deadlines",
      },
      {
        href: "/playbooks",
        label: "Playbooks",
        icon: BookOpen,
        description: "What worked. Reusable negotiation plays.",
      },
    ],
  },
];

const SYSTEM_GROUP: readonly NavItem[] = [
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Account, team, notifications, billing",
  },
];

export function SideNav({
  pendingRequestCount = 0,
  vendorUpdateCount = 0,
  spendReviewCount = 0,
}: {
  /** Pending procurement requests awaiting review. 0 hides the badge. */
  pendingRequestCount?: number;
  /** Unread vendor announcements in the customer inbox. 0 hides the badge. */
  vendorUpdateCount?: number;
  /** Auto-detected recurring charges awaiting review. 0 hides the badge. */
  spendReviewCount?: number;
}) {
  const pathname = usePathname();
  const counts = {
    pendingRequests: pendingRequestCount,
    vendorUpdates: vendorUpdateCount,
    spendReview: spendReviewCount,
  };

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand block — gives the sidebar its own identity instead of sharing
          the topbar with content. */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border/80 group"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card group-hover:bg-primary-strong transition-colors">
          <Zap className="h-4 w-4" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="font-display font-semibold text-[15px] tracking-tight">
            Renewal Radar
          </div>
          <div className="text-[11px] text-sidebar-muted-foreground">
            Renewal intelligence
          </div>
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
        {GROUPS.map((group) => (
          <NavGroup
            key={group.label}
            group={group}
            pathname={pathname}
            counts={counts}
          />
        ))}
      </nav>

      <div className="border-t border-sidebar-border/80 px-3 py-4 space-y-3">
        {SYSTEM_GROUP.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            counts={counts}
          />
        ))}
        <div className="rounded-md border border-sidebar-border/70 bg-background/70 p-3 text-[11px] text-sidebar-muted-foreground leading-snug">
          <div className="flex items-center gap-1.5 font-medium text-foreground mb-1">
            <Sparkles className="h-3 w-3 text-primary" />
            Tip
          </div>
          Upload one contract — we extract dates and terms in seconds.
        </div>
      </div>
    </aside>
  );
}

function NavGroup({
  group,
  pathname,
  counts,
}: {
  group: NavGroup;
  pathname: string;
  counts: Record<NonNullable<NavItem["badgeKey"]>, number>;
}) {
  return (
    <div className="space-y-1">
      <div className="px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-muted-foreground/80 mb-1.5">
        {group.label}
      </div>
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            counts={counts}
          />
        ))}
      </div>
    </div>
  );
}

function NavLink({
  item,
  pathname,
  counts,
}: {
  item: NavItem;
  pathname: string;
  counts: Record<NonNullable<NavItem["badgeKey"]>, number>;
}) {
  const Icon = item.icon;
  const isActive =
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));
  const badgeCount = item.badgeKey ? counts[item.badgeKey] : 0;
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      title={item.description}
      className={cn(
        "group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
        isActive
          ? "bg-primary/10 text-primary-strong font-medium"
          : "text-foreground/80 hover:bg-secondary hover:text-foreground"
      )}
    >
      {/* Left accent bar — visible only on active. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full transition-colors",
          isActive ? "bg-primary" : "bg-transparent"
        )}
      />
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          isActive ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="truncate">{item.label}</span>
      {badgeCount > 0 && (
        <span
          className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums"
          aria-label={`${badgeCount} pending`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </Link>
  );
}
