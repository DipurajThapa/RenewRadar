import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { TopNav } from "@ui/components/layout/top-nav";
import { SideNav } from "@ui/components/layout/side-nav";
import { DemoBanner } from "@ui/components/layout/demo-banner";
import { Toaster } from "@ui/components/primitives/toaster";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { isDemoMode } from "@server/middleware/demo-mode";
import { getPendingIntakeRequestCount } from "@server/application/intake-requests";
import { getUnreadVendorUpdateCount } from "@server/application/vendor-portal/customer-inbox";
import { countDetectedRecurringCharges } from "@server/infrastructure/db/repositories/spend";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense-in-depth: in real mode the middleware enforces auth on every
  // request; we re-check here in case middleware is bypassed or the route
  // matcher drifts. In demo mode the middleware is a no-op by design, so
  // we skip the duplicate check.
  if (!isDemoMode) {
    const { userId } = await auth();
    if (!userId) {
      redirect("/sign-in");
    }
  }

  const { account, user } = await getCurrentAccountAndUser();

  // Pending-request badge is only meaningful for approvers (owners + admins);
  // members/viewers can't action requests, so we don't surface the count to
  // them. Defaults to 0 on any error so a badge query can't break the shell.
  const isApprover = user.role === "owner" || user.role === "admin";
  const [pendingRequestCount, vendorUpdateCount, spendReviewCount] =
    await Promise.all([
      isApprover
        ? getPendingIntakeRequestCount(account.id).catch(() => 0)
        : Promise.resolve(0),
      // Vendor updates are visible to everyone in the account.
      getUnreadVendorUpdateCount(account.id).catch(() => 0),
      // Auto-detected recurring charges awaiting review.
      countDetectedRecurringCharges(account.id).catch(() => 0),
    ]);

  return (
    <div className="min-h-screen flex flex-col bg-secondary/30">
      {isDemoMode && <DemoBanner />}
      <div className="flex flex-1 min-h-0">
        <SideNav
          pendingRequestCount={pendingRequestCount}
          vendorUpdateCount={vendorUpdateCount}
          spendReviewCount={spendReviewCount}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <TopNav
            account={account}
            user={user}
            pendingRequestCount={pendingRequestCount}
            vendorUpdateCount={vendorUpdateCount}
            spendReviewCount={spendReviewCount}
          />
          {/*
           * Generous side padding and vertical rhythm so cards never butt
           * against the page edge. `max-w-[1400px]` keeps wide monitors
           * readable; pages can opt in to fluid widths by overriding the
           * inner container.
           */}
          <main className="flex-1 overflow-x-hidden">
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 md:px-10 py-6 sm:py-8 md:py-10 animate-fade-in">
              {children}
            </div>
          </main>
        </div>
      </div>
      <Toaster />
    </div>
  );
}
