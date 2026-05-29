"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@shared/utils";

/**
 * Vendor portal top-nav links. Rendered in the vendor layout header once a
 * vendor is signed in. Kept minimal — the portal has a small surface.
 */
const LINKS = [
  { href: "/vendor/dashboard", label: "Dashboard" },
  { href: "/vendor/connections", label: "Connections" },
  { href: "/vendor/announcements", label: "Announcements" },
] as const;

export function VendorPortalNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-teal-200/70 text-teal-900 font-medium"
                : "text-teal-900/70 hover:bg-teal-100/70 hover:text-teal-900"
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
