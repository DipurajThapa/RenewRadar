import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowRight, Zap } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { MobileNavSheet } from "@ui/components/layout/mobile-nav-sheet";
import { isDemoMode } from "@server/middleware/demo-mode";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/security", label: "Security" },
  { href: "/contact", label: "Contact" },
] as const;

/**
 * Marketing nav — sticky, translucent backdrop.
 *
 * CTA philosophy:
 *   - "View live demo" is the primary action: lowest friction, no commitment,
 *     and what a curious visitor actually wants. It deep-links to /dashboard
 *     which, when DEMO_MODE is on at deploy, renders the seeded demo
 *     directly; when off, sign-in middleware bounces the user to /sign-in
 *     with the dashboard as the return URL.
 *   - "Sign up" and "Sign in" are still visible but secondary.
 *
 * Mobile uses a slide-in sheet via MobileNavSheet.
 */
export async function MarketingNav() {
  let signedIn = false;
  if (!isDemoMode) {
    const { userId } = await auth();
    signedIn = Boolean(userId);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 h-16 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold group shrink-0"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card group-hover:bg-primary-strong transition-colors">
            <Zap className="h-4 w-4" />
          </span>
          <span className="font-display text-[15px] tracking-tight">
            Renewal Radar
          </span>
        </Link>

        {/* Desktop nav — visible at lg+ so 5 links + 3 CTAs don't crowd at
            md (~768–1023px); md falls back to the mobile hamburger. */}
        <nav
          aria-label="Primary"
          className="hidden lg:flex items-center gap-7 text-sm text-muted-foreground"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop CTAs — same lg+ threshold as the nav so they appear and
            disappear together. */}
        <div className="hidden lg:flex items-center gap-2">
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">
                Open dashboard
                <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild variant="subtle" size="sm">
                <Link href="/dashboard">View demo</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">
                  Start free
                  <ArrowRight />
                </Link>
              </Button>
            </>
          )}
        </div>

        {/* Mobile menu */}
        <MobileNavSheet
          links={NAV_LINKS}
          ctaPrimary={
            signedIn
              ? { href: "/dashboard", label: "Open dashboard" }
              : { href: "/sign-up", label: "Start free" }
          }
          ctaSecondary={
            signedIn
              ? undefined
              : { href: "/dashboard", label: "View live demo" }
          }
        />
      </div>
    </header>
  );
}
