import { Building2, Users } from "lucide-react";
import { requireCurrentVendor } from "@server/middleware/current-vendor";
import {
  listConnectedCustomers,
  listConnectionRequestsForVendor,
} from "@server/application/vendor-portal/connections";
import { ConnectionRequestRow } from "@ui/features/vendor/connection-request-row";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Connections · Vendor portal",
  robots: { index: false, follow: false },
};

export default async function VendorConnectionsPage() {
  const { vendorOrg } = await requireCurrentVendor();

  const [requests, connected] = await Promise.all([
    listConnectionRequestsForVendor(vendorOrg.id),
    listConnectedCustomers(vendorOrg.id),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-display font-semibold tracking-tight">
          Connections
        </h1>
        <p className="text-sm text-teal-900/70 mt-1">
          Customers who track you on Renewal Radar can request to receive your
          announcements. You only ever see their company name — never their
          team&apos;s email addresses.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Pending requests ({requests.length})
        </h2>
        {requests.length === 0 ? (
          <div className="rounded-md border border-dashed bg-white p-6 text-center text-sm text-muted-foreground">
            No pending requests right now.
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <ConnectionRequestRow
                key={r.id}
                connectionId={r.id}
                accountName={r.accountName}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground inline-flex items-center gap-2">
          <Users className="h-4 w-4" />
          Connected customers ({connected.length})
        </h2>
        {connected.length === 0 ? (
          <div className="rounded-md border border-dashed bg-white p-6 text-center text-sm text-muted-foreground">
            No connected customers yet. Accept a request above to start
            publishing announcements to them.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {connected.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-md border bg-white px-4 py-3 text-sm"
              >
                <Building2 className="h-4 w-4 text-teal-700 shrink-0" />
                <span className="truncate">{c.accountName}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
