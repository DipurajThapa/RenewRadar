import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { TopNav } from "@ui/components/layout/top-nav";
import { SideNav } from "@ui/components/layout/side-nav";
import { DemoBanner } from "@ui/components/layout/demo-banner";
import { Toaster } from "@ui/components/primitives/toaster";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { isDemoMode } from "@server/middleware/demo-mode";

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

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {isDemoMode && <DemoBanner />}
      <TopNav account={account} user={user} />
      <div className="flex flex-1">
        <SideNav />
        <main className="flex-1 px-4 md:px-8 py-6 overflow-x-auto">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
