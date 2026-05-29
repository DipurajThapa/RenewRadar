import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireCurrentVendor } from "@server/middleware/current-vendor";
import { composeAnnouncementAction } from "@app/vendor/announcements/actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "New announcement · Vendor portal",
  robots: { index: false, follow: false },
};

export default async function NewAnnouncementPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const { vendorOrg } = await requireCurrentVendor();
  if (vendorOrg.status !== "active" || !vendorOrg.domainVerifiedAt) {
    redirect("/vendor/verify-domain");
  }
  const sp = (await searchParams) ?? {};

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        href="/vendor/announcements"
        className="text-xs text-teal-900/70 inline-flex items-center gap-1 hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to announcements
      </Link>

      <div>
        <h1 className="text-2xl font-display font-semibold tracking-tight">
          New announcement
        </h1>
        <p className="text-sm text-teal-900/70 mt-1">
          This goes to every connected customer&apos;s vendor-updates inbox.
          They decide what to do with it — you can&apos;t act on their account.
        </p>
      </div>

      {sp.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {sp.error}
        </div>
      )}

      <form action={composeAnnouncementAction} className="space-y-4">
        <div>
          <label htmlFor="kind" className="text-sm font-medium">
            Type
          </label>
          <select
            id="kind"
            name="kind"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          >
            <option value="price_change">Price change</option>
            <option value="renewal_reminder">Renewal reminder</option>
            <option value="eol">End-of-life notice</option>
            <option value="general">General update</option>
          </select>
        </div>

        <div>
          <label htmlFor="title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={140}
            placeholder="e.g. List prices increase 8% on Jan 1"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
        </div>

        <div>
          <label htmlFor="effectiveDate" className="text-sm font-medium">
            Effective date <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="effectiveDate"
            name="effectiveDate"
            type="date"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
        </div>

        <div>
          <label htmlFor="body" className="text-sm font-medium">
            Message
          </label>
          <textarea
            id="body"
            name="body"
            required
            minLength={1}
            maxLength={4000}
            rows={8}
            placeholder="What's changing, when, and what (if anything) the customer needs to know."
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="submit"
            name="intent"
            value="draft"
            className="rounded-md border bg-background hover:bg-muted/40 px-3 py-1.5 text-sm"
          >
            Save draft
          </button>
          <button
            type="submit"
            name="intent"
            value="publish"
            className="rounded-md bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 text-sm font-medium"
          >
            Publish now
          </button>
        </div>
      </form>
    </div>
  );
}
