import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireCurrentStaff } from "@server/middleware/current-staff";
import { getActiveSupportSession } from "@server/application/support-sessions";

/**
 * Staff layout — deliberately visually distinct from the customer app so a
 * staff member looking at a customer's data can never confuse it for their
 * own. Amber accent + "OPERATIONS" branding + the active session strip at
 * the top.
 *
 * The staff identity check runs at layout level — any subroute is also
 * gated. Non-staff get a 404 (notFound()) inside requireCurrentStaff.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await requireCurrentStaff();
  const activeSession = await getActiveSupportSession(staff.id);

  return (
    <div className="min-h-screen bg-amber-50/40">
      <header className="border-b border-amber-200 bg-amber-100/60">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-700" />
            <Link
              href="/staff"
              className="font-display font-semibold tracking-tight text-amber-900"
            >
              Renewal Radar · Operations
            </Link>
          </div>
          <div className="text-xs text-amber-900/80 tabular-nums">
            {staff.fullName ?? staff.email}
            <span className="text-amber-900/50"> · {staff.role}</span>
          </div>
        </div>
        {activeSession && (
          <div className="bg-amber-200/80 border-t border-amber-300">
            <div className="max-w-7xl mx-auto px-6 py-2 text-xs text-amber-950 flex items-center justify-between gap-4">
              <div>
                <span className="font-semibold">Active session</span>
                <span className="text-amber-800"> · </span>
                {activeSession.reason}
                <span className="text-amber-800"> · expires </span>
                {activeSession.expiresAt.toLocaleString()}
              </div>
              <Link
                href={`/staff/accounts/${activeSession.accountId}`}
                className="underline underline-offset-2"
              >
                Open
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
