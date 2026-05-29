import { MarketingNav } from "@ui/features/marketing/marketing-nav";
import { MarketingFooter } from "@ui/features/marketing/marketing-footer";

/**
 * Marketing-surface layout. Wraps every public page (home, pricing,
 * security, terms, privacy, DPA, etc.) so the nav + footer are written
 * once and rendered consistently.
 *
 * No auth check here on purpose — these pages must be reachable signed-out.
 * Signed-in users see the same shell, but the nav swaps the CTA pair for
 * an "Open dashboard" button (handled inside `MarketingNav`).
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background text-foreground min-h-screen flex flex-col">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
