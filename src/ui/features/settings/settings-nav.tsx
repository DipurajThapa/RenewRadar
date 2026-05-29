"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Building2,
  CreditCard,
  Key,
  KeyRound,
  ScrollText,
  Users,
} from "lucide-react";
import { cn } from "@shared/utils";

/**
 * Settings sub-nav. Mirrors the main SideNav active-state treatment so the
 * settings space feels like a peer of the main app, not a one-off.
 */
const SECTIONS = [
  { href: "/settings/account", label: "Account", icon: Building2 },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/integrations", label: "Integrations", icon: KeyRound },
  { href: "/settings/api-keys", label: "API keys", icon: Key },
  { href: "/settings/billing", label: "Plan & Billing", icon: CreditCard },
  { href: "/settings/system-health", label: "System health", icon: Activity },
  { href: "/settings/audit", label: "Audit log", icon: ScrollText },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="space-y-1">
      {SECTIONS.map((section) => {
        const isActive = pathname === section.href;
        const Icon = section.icon;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              isActive
                ? "bg-primary/10 text-primary-strong font-medium"
                : "text-foreground/80 hover:bg-secondary hover:text-foreground"
            )}
          >
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
            <span className="truncate">{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
