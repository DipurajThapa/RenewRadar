"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Menu, X, Zap } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { cn } from "@shared/utils";

export type MobileNavLink = {
  href: string;
  label: string;
  external?: boolean;
};

/**
 * Sliding mobile nav. Pure React + Tailwind — no dependency on a sheet
 * library. The trigger is a hamburger; the panel slides in from the right
 * with a translucent backdrop. Auto-closes on pathname change so a tap on
 * a link doesn't leave the panel hanging.
 *
 * Used by both MarketingNav (with links) and the app TopNav (with a
 * children slot so the SideNav can be reused inside the drawer).
 */
export function MobileNavSheet({
  links,
  ctaPrimary,
  ctaSecondary,
  children,
  triggerLabel = "Open menu",
  triggerClassName = "lg:hidden",
}: {
  links?: readonly MobileNavLink[];
  ctaPrimary?: { href: string; label: string };
  ctaSecondary?: { href: string; label: string };
  children?: React.ReactNode;
  triggerLabel?: string;
  /**
   * Tailwind responsive classes that control when the trigger is hidden.
   *
   *   marketing → "lg:hidden" (desktop nav appears at lg, so hamburger
   *               handles everything below)
   *   app shell → "md:hidden" (SideNav appears at md, so the hamburger only
   *               needs to cover phones)
   */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on navigation. usePathname changes on route change so this fires
  // exactly once per nav, without polling history.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the sheet is open. Restored on close — important
  // on iOS where overflow:hidden alone doesn't always stop touch-scroll.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes the sheet — standard a11y for any overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls="mobile-nav-sheet"
        onClick={() => setOpen(true)}
        className={triggerClassName}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Backdrop + panel — rendered always so the close animation can run.
          `pointer-events-none` when closed so the trigger underneath is
          clickable; `pointer-events-auto` when open. */}
      <div
        aria-hidden={!open}
        className={cn(
          "fixed inset-0 z-50 transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      >
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="absolute inset-0 bg-foreground/60 backdrop-blur-sm"
        />
        <aside
          id="mobile-nav-sheet"
          role="dialog"
          aria-modal="true"
          className={cn(
            "absolute right-0 top-0 h-full w-[88%] max-w-sm bg-background shadow-pop",
            "transition-transform duration-300 ease-out",
            "flex flex-col",
            open ? "translate-x-0" : "translate-x-full"
          )}
        >
          <header className="flex items-center justify-between px-5 h-16 border-b border-border">
            <Link
              href="/"
              className="flex items-center gap-2.5 font-semibold"
              onClick={() => setOpen(false)}
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card">
                <Zap className="h-4 w-4" />
              </span>
              <span className="font-display tracking-tight">
                Renewal Radar
              </span>
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </header>

          <nav className="flex-1 overflow-y-auto p-5 space-y-1">
            {links?.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  className="block px-3 py-2.5 rounded-md text-base font-medium text-foreground/85 hover:bg-secondary"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block px-3 py-2.5 rounded-md text-base font-medium text-foreground/85 hover:bg-secondary"
                >
                  {link.label}
                </Link>
              )
            )}
            {children}
          </nav>

          {(ctaPrimary || ctaSecondary) && (
            <div className="border-t border-border p-5 space-y-2">
              {ctaPrimary && (
                <Button asChild size="lg" className="w-full">
                  <Link href={ctaPrimary.href}>{ctaPrimary.label}</Link>
                </Button>
              )}
              {ctaSecondary && (
                <Button asChild variant="outline" size="lg" className="w-full">
                  <Link href={ctaSecondary.href}>{ctaSecondary.label}</Link>
                </Button>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
