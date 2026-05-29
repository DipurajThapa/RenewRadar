import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { submitRequestFormAction } from "@app/(app)/requests/actions";
import { PageHeader } from "@ui/components/shared/page-header";

export const dynamic = "force-dynamic";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  await getCurrentAccountAndUser();

  return (
    <div className="space-y-8 max-w-2xl">
      <Link
        href="/requests"
        className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to requests
      </Link>
      <PageHeader>
        <PageHeader.Title>Request a new SaaS</PageHeader.Title>
        <PageHeader.Description>
          Tell procurement what you want and why. Approved requests become
          drafts in Subscriptions — you don&apos;t have to chase anyone over
          Slack.
        </PageHeader.Description>
      </PageHeader>

      {sp.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {sp.error}
        </div>
      )}

      <form action={submitRequestFormAction} className="space-y-4">
        <div>
          <label htmlFor="vendor" className="text-sm font-medium">
            Vendor
          </label>
          <input
            id="vendor"
            name="vendor"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Linear, Notion, Figma"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
        </div>
        <div>
          <label htmlFor="product" className="text-sm font-medium">
            Product
          </label>
          <input
            id="product"
            name="product"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Standard, Team Plan, Business+"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
        </div>
        <div>
          <label htmlFor="planNotes" className="text-sm font-medium">
            Plan / tier notes <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="planNotes"
            name="planNotes"
            type="text"
            maxLength={200}
            placeholder="e.g. Enterprise tier, 5 seats"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
        </div>
        <div>
          <label htmlFor="estimatedAnnualUsdDollars" className="text-sm font-medium">
            Estimated annual cost (USD)
          </label>
          <input
            id="estimatedAnnualUsdDollars"
            name="estimatedAnnualUsdDollars"
            type="number"
            inputMode="decimal"
            required
            min={0}
            step={0.01}
            placeholder="12000"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
        </div>
        <div>
          <label htmlFor="expectedStartDate" className="text-sm font-medium">
            Expected start <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="expectedStartDate"
            name="expectedStartDate"
            type="date"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
        </div>
        <div>
          <label htmlFor="businessCase" className="text-sm font-medium">
            Business case
          </label>
          <textarea
            id="businessCase"
            name="businessCase"
            required
            minLength={20}
            maxLength={2000}
            rows={6}
            placeholder="Why does the team need this? What gap does it close, what does it replace, what's the ROI?"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Minimum 20 characters. Be specific — the reviewer needs context to
            decide quickly.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/requests"
            className="rounded-md border bg-background hover:bg-muted/40 px-3 py-1.5 text-sm"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="rounded-md bg-foreground text-background hover:bg-foreground/90 px-3 py-1.5 text-sm font-medium"
          >
            Submit request
          </button>
        </div>
      </form>
    </div>
  );
}
