import Link from "next/link";
import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { getCurrentVendor } from "@server/middleware/current-vendor";
import { submitSignInFormAction } from "@app/vendor/actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Vendor sign in",
  robots: { index: false, follow: false },
};

export default async function VendorSignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const vendor = await getCurrentVendor();
  if (vendor) redirect("/vendor/dashboard");

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white mb-3">
          <Megaphone className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-display font-semibold tracking-tight">
          Vendor portal
        </h1>
        <p className="text-sm text-teal-900/70 mt-1">
          Publish renewal reminders, price changes, and EOL notices straight
          to your customers&apos; Renewal Radar inbox.
        </p>
      </div>

      {sp.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 mb-4">
          {sp.error}
        </div>
      )}

      <form
        action={submitSignInFormAction}
        className="space-y-4 rounded-lg border border-teal-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label htmlFor="email" className="text-sm font-medium">
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@yourcompany.com"
            className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            We&apos;ll email you a one-time sign-in link. No password.
          </p>
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 text-sm font-medium"
        >
          Email me a sign-in link
        </button>
      </form>

      <p className="mt-6 text-xs text-center text-teal-900/60">
        Customer of Renewal Radar?{" "}
        <Link href="/sign-in" className="underline underline-offset-2">
          Sign in to your customer account →
        </Link>
      </p>
    </div>
  );
}
