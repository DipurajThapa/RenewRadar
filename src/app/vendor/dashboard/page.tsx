import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Megaphone } from "lucide-react";
import { requireCurrentVendor } from "@server/middleware/current-vendor";
import { signOutAction } from "@app/vendor/actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Vendor dashboard",
  robots: { index: false, follow: false },
};

/**
 * Slice 1 dashboard — keeps the signed-in user oriented without inventing
 * features that don't ship yet. Each card describes what arrives in the
 * subsequent slices and what they need to do once it does.
 *
 * Slice 2 fills in the "Verify your domain" CTA below.
 * Slice 3 fills in the "Connect to customers" card.
 * Slice 4 fills in the "Publish an announcement" card.
 */
export default async function VendorDashboardPage() {
  const { vendorOrg, vendorUser } = await requireCurrentVendor();
  const domainVerified = vendorOrg.domainVerifiedAt !== null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-teal-900/60 font-medium">
            Vendor portal
          </p>
          <h1 className="text-2xl font-display font-semibold tracking-tight">
            Welcome, {vendorUser.fullName ?? vendorUser.email.split("@")[0]}.
          </h1>
          <p className="text-sm text-teal-900/70 mt-1">
            You&apos;re signed in as{" "}
            <strong>{vendorOrg.displayName}</strong>
            {vendorUser.role === "admin" && (
              <span className="text-teal-700"> · admin</span>
            )}
            .
          </p>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-md border border-teal-300 bg-white hover:bg-teal-50 px-3 py-1.5 text-sm text-teal-900"
          >
            Sign out
          </button>
        </form>
      </header>

      {/* Domain verification banner — the gating step for going active. */}
      <section
        className={
          domainVerified
            ? "rounded-lg border border-teal-200 bg-teal-50/60 p-4"
            : "rounded-lg border border-amber-300 bg-amber-50 p-4"
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {domainVerified ? (
              <CheckCircle2 className="h-5 w-5 text-teal-700 mt-0.5" />
            ) : (
              <Clock className="h-5 w-5 text-amber-700 mt-0.5" />
            )}
            <div className="text-sm">
              {domainVerified ? (
                <>
                  <div className="font-medium text-teal-900">
                    {vendorOrg.primaryDomain} verified
                  </div>
                  <div className="text-teal-900/70">
                    Customers will see a verified badge next to your
                    announcements.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-medium text-amber-900">
                    Verify {vendorOrg.primaryDomain} to publish to customers
                  </div>
                  <div className="text-amber-900/80">
                    Until your domain is verified, your account stays in
                    pending mode. Customers won&apos;t see your announcements.
                  </div>
                </>
              )}
            </div>
          </div>
          {!domainVerified && (
            <Link
              href="/vendor/verify-domain"
              className="shrink-0 rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-sm font-medium"
            >
              Verify now
            </Link>
          )}
        </div>
      </section>

      {/* Roadmap cards. These describe upcoming slices honestly — no
          links to features that don't exist yet. */}
      <section className="grid gap-4 md:grid-cols-3">
        <RoadmapCard
          step={2}
          title="Verify your domain"
          body="DNS TXT challenge. Adds a verified badge customers can see."
        />
        <RoadmapCard
          step={3}
          title="Connect to customers"
          body="Customers who already track you on Renewal Radar can opt in to your announcements."
        />
        <RoadmapCard
          step={4}
          title="Publish announcements"
          body="Price changes, renewal reminders, EOL notices — straight into your customers' inbox."
        />
      </section>

      <section className="rounded-md border bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">
          Your account
        </h2>
        <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <dt className="text-muted-foreground">Company</dt>
          <dd>{vendorOrg.displayName}</dd>
          <dt className="text-muted-foreground">Domain</dt>
          <dd className="font-mono text-xs">{vendorOrg.primaryDomain}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="capitalize">{vendorOrg.status}</dd>
          <dt className="text-muted-foreground">Your role</dt>
          <dd className="capitalize">{vendorUser.role}</dd>
          <dt className="text-muted-foreground">Last sign-in</dt>
          <dd>
            {vendorUser.lastLoginAt
              ? new Date(vendorUser.lastLoginAt).toLocaleString()
              : "Just now"}
          </dd>
        </dl>
      </section>

      <p className="text-xs text-teal-900/60">
        <Megaphone className="inline h-3 w-3 mr-1" />
        Renewal Radar customers control whether they hear from you. We never
        email customers on your behalf, and we never share customer email
        addresses with vendors.
      </p>
    </div>
  );
}

function RoadmapCard({
  step,
  title,
  body,
}: {
  step: number;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-md border bg-white p-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-teal-900/50 font-semibold mb-1">
        Next · Slice {step}
      </div>
      <div className="text-sm font-semibold text-teal-900 mb-1">{title}</div>
      <p className="text-xs text-teal-900/70 leading-relaxed">{body}</p>
      <div className="mt-3 flex items-center text-[11px] text-teal-700/60 font-medium">
        <ArrowRight className="h-3 w-3 mr-1" /> Ships next
      </div>
    </div>
  );
}
