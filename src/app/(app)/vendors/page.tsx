import Link from "next/link";
import { Briefcase } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listVendorsWithIntelligence } from "@server/infrastructure/db/repositories/vendor-memory";
import { Card, CardContent } from "@ui/components/primitives/card";
import { EmptyState } from "@ui/components/shared/empty-state";
import { formatCurrency, formatDate } from "@shared/utils";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const { account } = await getCurrentAccountAndUser();
  const vendors = await listVendorsWithIntelligence(account.id);

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every vendor you track. Click into one for the full relationship
          timeline, decision history, and compliance status.
        </p>
      </header>

      {vendors.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="h-8 w-8" />}
          title="No vendors yet"
          description="Vendors appear here automatically when you add subscriptions."
        />
      ) : (
        <div className="rounded-lg border bg-white">
          <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/30">
            <div>Vendor</div>
            <div className="text-right">Active subs</div>
            <div className="text-right">Annualized spend</div>
            <div>Last activity</div>
            <div />
          </div>
          <ul className="divide-y">
            {vendors.map((v) => (
              <li
                key={v.id}
                className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center text-sm hover:bg-muted/30"
              >
                <div>
                  <Link
                    href={`/vendors/${v.id}`}
                    className="font-medium hover:underline"
                  >
                    {v.name}
                  </Link>
                  {v.website && (
                    <div className="text-xs text-muted-foreground truncate">
                      {v.website}
                    </div>
                  )}
                </div>
                <div className="text-right tabular-nums hidden md:block">
                  {v.subscriptionCount}
                </div>
                <div className="text-right tabular-nums hidden md:block">
                  {formatCurrency(v.annualizedSpendCents)}
                </div>
                <div className="text-xs text-muted-foreground hidden md:block">
                  {v.lastEventAt ? formatDate(v.lastEventAt) : "—"}
                </div>
                <Link
                  href={`/vendors/${v.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
