import { Card, CardContent } from "@ui/components/primitives/card";
import { PageHeader } from "@ui/components/shared/page-header";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  getNoticeDeadlineKpis,
  listNoticeDeadlines,
} from "@server/infrastructure/db/repositories/notice-deadlines";
import { NoticeDeadlineKpiStrip } from "@ui/features/notice-deadlines/kpi-strip";
import { NoticeDeadlineFilters } from "@ui/features/notice-deadlines/filters";
import { parseRange, parseStatus } from "@server/domain/notice-deadline/parse";
import { NoticeDeadlineCalendar } from "@ui/features/notice-deadlines/calendar";

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
    <div className="space-y-8">
      <PageHeader>
        <PageHeader.Title>Notice deadlines</PageHeader.Title>
        <PageHeader.Description>
          The dates by which you must give written notice to avoid auto-renewal.
        </PageHeader.Description>
      </PageHeader>

      <NoticeDeadlineKpiStrip kpis={kpis} />

      <NoticeDeadlineFilters filter={filter} />

      {rows.length === 0 ? (
        <EmptyState rangeDays={filter.range} status={filter.status} />
      ) : (
        <NoticeDeadlineCalendar rows={rows} />
      )}
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
