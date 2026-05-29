import { requireCurrentStaff } from "@server/middleware/current-staff";
import { listVendorOrgsForStaff } from "@server/application/vendor-portal/staff-admin";
import { VendorAdminActions } from "@ui/features/staff/vendor-admin-row";

export const dynamic = "force-dynamic";

/**
 * T4.10 Slice 6 — staff vendor-org trust console.
 * Lists every vendor org with verification state, connected-customer count,
 * and complaint count, plus the manual-verify / suspend / reinstate controls.
 */
export default async function StaffVendorsPage() {
  await requireCurrentStaff();
  const orgs = await listVendorOrgsForStaff();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-display font-semibold text-amber-900">
          Vendor orgs
        </h1>
        <p className="text-sm text-amber-900/70 mt-1">
          Trust administration for the vendor portal. Suspend a vendor that
          accrues spam complaints; manually verify a domain as a break-glass.
        </p>
      </header>

      {orgs.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-white p-8 text-center text-sm text-amber-900/60">
          No vendor orgs yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-amber-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-amber-50 text-amber-900/70 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Vendor</th>
                <th className="text-left px-4 py-2">Domain</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Customers</th>
                <th className="text-right px-4 py-2">Complaints</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-t border-amber-100">
                  <td className="px-4 py-2 font-medium">{o.displayName}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {o.primaryDomain}
                    {o.domainVerifiedAt && (
                      <span className="ml-1 text-teal-700">✓</span>
                    )}
                  </td>
                  <td className="px-4 py-2 capitalize">{o.status}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {o.connectedCustomers}
                  </td>
                  <td
                    className={
                      "px-4 py-2 text-right tabular-nums " +
                      (o.complaintCount > 0 ? "text-red-600 font-semibold" : "")
                    }
                  >
                    {o.complaintCount}
                  </td>
                  <td className="px-4 py-2">
                    <VendorAdminActions
                      vendorOrgId={o.id}
                      status={o.status}
                      domainVerified={o.domainVerifiedAt !== null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
