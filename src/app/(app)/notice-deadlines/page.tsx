import { Card, CardContent } from "@/components/ui/card";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import {
  getNoticeDeadlineKpis,
  listNoticeDeadlines,
} from "@/lib/db/queries/notice-deadlines";
import { NoticeDeadlineKpiStrip } from "@/components/notice-deadlines/kpi-strip";
import { NoticeDeadlineFilters } from "@/components/notice-deadlines/filters";
import { parseRange, parseStatus } from "@/lib/notice-deadline/parse";
import { NoticeDeadlineCalendar } from "@/components/notice-deadlines/calendar";

export const dynamic = "force-dynamic";

export default async function NoticeDeadlinesPage({
  searchParams,
}: {
  searchParams: { range?: string; status?: string };
}) {
  const { account } = await getCurrentAccountAndUser();

  const filter = {
    range: parseRange(searchParams.range),
    status: parseStatus(searchParams.status),
  };

  const [rows, kpis] = await Promise.all([
    listNoticeDeadlines(account.id, filter),
    getNoticeDeadlineKpis(account.id),
  ]);

  return (
    <div className="space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold">Notice Deadlines</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The dates by which you must give written notice to avoid auto-renewal.
        </p>
      </header>

      <NoticeDeadlineKpiStrip kpis={kpis} />

      <NoticeDeadlineFilters filter={filter} />

      {rows.length === 0 ? <EmptyState rangeDays={filter.range} status={filter.status} /> : <NoticeDeadlineCalendar rows={rows} />}
    </div>
  );
}

function EmptyState({
  rangeDays,
  status,
}: {
  rangeDays: number;
  status: string;
}) {
  return (
    <Card>
      <CardContent className="py-16 text-center space-y-3">
        <div className="text-green-700 text-3xl" aria-hidden>
          ✓
        </div>
        <p className="text-lg font-medium">All clear</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          No notice deadlines in the next {rangeDays} days
          {status !== "all" && ` matching "${status.replace(/_/g, " ")}"`}.
        </p>
      </CardContent>
    </Card>
  );
}
