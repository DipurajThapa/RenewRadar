import Link from "next/link";
import { listAccountsForStaff } from "@app/staff/actions";

/**
 * Staff dashboard — list of accounts the operator can act on. Search by
 * name or billing email. Clicking through navigates to the per-account
 * staff page where a session can be started.
 *
 * Read-only listing — no session required to LOOK. Acting on data is
 * gated separately by `requireActiveSession`.
 */
export const dynamic = "force-dynamic";

export default async function StaffDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const query = sp.q?.trim();
  const accounts = await listAccountsForStaff(query);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Customer accounts
          </h1>
          <Link
            href="/staff/vendors"
            className="rounded-md border border-amber-300 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 text-sm font-medium text-amber-900"
          >
            Vendor orgs →
          </Link>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Pick an account to assist. Starting a support session requires a
          reason and notifies the account owners by email. Sessions auto-
          expire after 4 hours.
        </p>
      </div>

      {sp.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {sp.error}
        </div>
      )}

      <form action="/staff" method="get" className="flex gap-2">
        <input
          name="q"
          type="search"
          placeholder="Search by name or billing email"
          defaultValue={query ?? ""}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border bg-amber-100 hover:bg-amber-200 px-3 py-1.5 text-sm font-medium text-amber-900 border-amber-300"
        >
          Search
        </button>
      </form>

      {accounts.length === 0 ? (
        <div className="rounded-md border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          No accounts {query ? `match "${query}"` : "to show"}.
        </div>
      ) : (
        <ul className="rounded-md border bg-background divide-y">
          {accounts.map((a) => (
            <li key={a.id}>
              <Link
                href={`/staff/accounts/${a.id}`}
                className="block px-4 py-3 hover:bg-muted/40"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">
                      {a.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.billingEmail}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {a.subscriptionCount} subs · {a.planTier}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
