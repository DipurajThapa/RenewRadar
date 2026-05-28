import Link from "next/link";
import { ListChecks } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  listActionQueueRows,
  rollupActionQueue,
} from "@server/infrastructure/db/repositories/action-queue";
import { ActionQueueTable } from "@ui/features/action-queue/queue-table";
import { EmptyState } from "@ui/components/shared/empty-state";
import { Card, CardContent } from "@ui/components/primitives/card";
import { formatCurrency } from "@shared/utils";

export const dynamic = "force-dynamic";

/**
 * Action Queue — the cross-subscription "what to do next" view.
 *
 * Implementation per `docs/FINAL_FEATURES_AND_IMPLEMENTATION_PLAN.md` §3.4 +
 * §7.B. Lists every renewal event in notice_window/action_needed/missed OR
 * within 60 days of its notice deadline, scored by `lib/risk/score.ts` and
 * sorted by (missed-first, band, earliest-deadline).
 *
 * The user clicks a row → Decide-Now flow for that renewal.
 */
export default async function ActionQueuePage() {
  const { account } = await getCurrentAccountAndUser();
  const rows = await listActionQueueRows(account.id);
  const rollup = rollupActionQueue(rows);

  return (
    <div className="space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold">Action Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Renewals that need a decision soon, ranked by composite risk
          (urgency × value × auto-renew).
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="You're all clear"
          description="No renewals need attention in the next 60 days. New ones will appear here as their notice deadlines approach."
          variant="success"
          action={
            <Link
              href="/subscriptions"
              className="inline-flex items-center justify-center rounded-md border bg-white px-4 py-2 text-sm hover:bg-muted/40"
            >
              View all subscriptions
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Rollup label="High" count={rollup.high} tone="bg-red-50 text-red-900" />
            <Rollup
              label="Medium"
              count={rollup.medium}
              tone="bg-amber-50 text-amber-900"
            />
            <Rollup
              label="Low"
              count={rollup.low}
              tone="bg-gray-50 text-gray-800"
            />
            <Card>
              <CardContent className="py-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  At stake
                </div>
                <div className="text-2xl font-semibold tabular-nums mt-1">
                  {formatCurrency(rollup.totalAnnualValueAtRiskCents)}
                </div>
                <div className="text-xs text-muted-foreground">per year</div>
              </CardContent>
            </Card>
          </div>

          <ActionQueueTable rows={rows} />
        </>
      )}
    </div>
  );
}

function Rollup({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums mt-2">{count}</div>
        <div className="text-xs text-muted-foreground">
          {count === 1 ? "renewal" : "renewals"}
        </div>
      </CardContent>
    </Card>
  );
}
