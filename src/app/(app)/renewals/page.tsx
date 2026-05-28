import { Card, CardContent } from "@ui/components/primitives/card";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  listRenewalsInRange,
  type RenewalRange,
} from "@server/infrastructure/db/repositories/renewals";
import { RenewalCalendar } from "@ui/features/renewals/calendar";

export const dynamic = "force-dynamic";

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const { account } = await getCurrentAccountAndUser();
  const range = parseRange(searchParams.range);
  const rows = await listRenewalsInRange(account.id, range);

  return (
    <div className="space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold">Renewal Calendar</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Forward view of all subscription renewals over the next {range} days.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No renewals in the next {range} days.
          </CardContent>
        </Card>
      ) : (
        <RenewalCalendar rows={rows} />
      )}
    </div>
  );
}

function parseRange(value?: string): RenewalRange {
  if (value === "30") return 30;
  if (value === "180") return 180;
  if (value === "365") return 365;
  return 90;
}
