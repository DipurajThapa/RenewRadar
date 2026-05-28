import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";
import { isDemoMode } from "@/lib/demo-mode";

export async function MarketingNav() {
  // In demo mode, skip Clerk entirely. Otherwise check sign-in to show the
  // right CTA. This is the sole call to auth() on the marketing surface.
  let signedIn = false;
  if (!isDemoMode) {
    const { userId } = await auth();
    signedIn = Boolean(userId);
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link
          href="/"
          className="font-semibold text-base flex items-center gap-2"
        >
          <span aria-hidden className="text-lg">
            ⚡
          </span>
          <span>Renewal Radar</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <Link
            href="/#how-it-works"
            className="hover:text-foreground transition-colors"
          >
            How it works
          </Link>
          <Link
            href="/#features"
            className="hover:text-foreground transition-colors"
          >
            Features
          </Link>
          <Link
            href="/pricing"
            className="hover:text-foreground transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/#faq"
            className="hover:text-foreground transition-colors"
          >
            FAQ
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {isDemoMode ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">Open demo →</Link>
            </Button>
          ) : signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Open dashboard →</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">Start free →</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
