import Link from "next/link";
import { Megaphone } from "lucide-react";
import { getCurrentVendor } from "@server/middleware/current-vendor";
import { VendorPortalNav } from "@ui/features/vendor/vendor-portal-nav";

/**
 * Vendor portal layout — deliberately visually distinct from both the
 * customer app (indigo) and the staff console (amber). Teal accent
 * + "VENDOR PORTAL" branding signals "you are pushing announcements OUT
 * to your customers; the rules here are different."
 *
 * Identity is resolved per-request via `getCurrentVendor()`. Pages that
 * strictly require auth call `requireCurrentVendor()` themselves —
 * /vendor/sign-in and /vendor/auth/* must render for signed-out users.
 */
export const dynamic = "force-dynamic";

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const vendor = await getCurrentVendor();

  return (
    <div className="min-h-screen bg-teal-50/40">
      <header className="border-b border-teal-200 bg-teal-100/60">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Megaphone className="h-5 w-5 text-teal-700" />
            <Link
              href="/vendor"
              className="font-display font-semibold tracking-tight text-teal-900"
            >
              Renewal Radar · Vendor portal
            </Link>
            {vendor && (
              <div className="hidden sm:block ml-4">
                <VendorPortalNav />
              </div>
            )}
          </div>
          <div className="text-xs text-teal-900/80 tabular-nums text-right">
            {vendor ? (
              <>
                <div className="font-medium">{vendor.vendorOrg.displayName}</div>
                <div className="text-teal-900/60">
                  {vendor.vendorUser.email}
                  {vendor.vendorOrg.status === "pending" && (
                    <span className="ml-1 inline-block rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                      domain not verified
                    </span>
                  )}
                </div>
              </>
            ) : (
              <Link
                href="/vendor/sign-in"
                className="underline underline-offset-2"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">{children}</main>

      <footer className="border-t border-teal-200/60 bg-teal-50/60 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-4 text-xs text-teal-900/60 flex items-center justify-between gap-4">
          <div>
            Vendor portal · Renewal Radar never emails your customers without
            their consent.
          </div>
          <Link href="/" className="underline underline-offset-2">
            Customer site
          </Link>
        </div>
      </footer>
    </div>
  );
}
