"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  AlertTriangle,
  CalendarDays,
  ListChecks,
  ShieldCheck,
  BarChart3,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Action Queue ships in Phase B (`docs/FINAL_FEATURES_AND_IMPLEMENTATION_PLAN.md`).
// The nav entry is wired up now to lock the route in place — the page itself
// is a Phase-B empty-state stub until the underlying query lands.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/action-queue", label: "Action Queue", icon: ListChecks },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/subscriptions", label: "Subscriptions", icon: Inbox },
  { href: "/notice-deadlines", label: "Notice Deadlines", icon: AlertTriangle },
  { href: "/renewals", label: "Renewals", icon: CalendarDays },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function SideNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:block w-56 shrink-0 border-r bg-muted/20 px-3 py-6">
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-foreground text-background"
                  : "text-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
