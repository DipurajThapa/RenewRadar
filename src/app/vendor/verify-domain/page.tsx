import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireCurrentVendor } from "@server/middleware/current-vendor";
import {
  expectedTxtValue,
  getLatestVerification,
  startDomainVerification,
  verificationHost,
} from "@server/application/vendor-portal/domain-verification";
import { DomainVerifier } from "@ui/features/vendor/domain-verifier";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Verify domain · Vendor portal",
  robots: { index: false, follow: false },
};

export default async function VerifyDomainPage() {
  const { vendorOrg, vendorUser } = await requireCurrentVendor();

  const alreadyVerified = vendorOrg.domainVerifiedAt !== null;

  // Ensure a pending verification exists so the page can render the record
  // immediately (idempotent — reuses an existing pending row).
  let host = verificationHost(vendorOrg.primaryDomain);
  let value = "";
  if (!alreadyVerified) {
    const existing = await getLatestVerification(vendorOrg.id);
    if (existing && existing.status === "pending") {
      host = verificationHost(existing.domain);
      value = expectedTxtValue(existing.token);
    } else {
      const started = await startDomainVerification({
        vendorOrgId: vendorOrg.id,
        vendorUserId: vendorUser.id,
      });
      host = started.host;
      value = started.expectedValue;
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <Link
        href="/vendor/dashboard"
        className="text-xs text-teal-900/70 inline-flex items-center gap-1 hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to dashboard
      </Link>

      <div>
        <p className="text-xs uppercase tracking-[0.12em] text-teal-900/60 font-medium">
          Slice 2 · Domain verification
        </p>
        <h1 className="text-2xl font-display font-semibold tracking-tight">
          Verify {vendorOrg.primaryDomain}
        </h1>
        <p className="text-sm text-teal-900/70 mt-1">
          Proving you control this domain unlocks publishing and gives
          customers a verified badge. We use a DNS TXT record — nothing is
          changed on your site.
        </p>
      </div>

      <DomainVerifier
        initialHost={host}
        initialValue={value}
        initialVerified={alreadyVerified}
      />
    </div>
  );
}
