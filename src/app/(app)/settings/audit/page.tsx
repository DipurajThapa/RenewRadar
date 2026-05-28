import Link from "next/link";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import {
  listAuditEntries,
  listAuditEntityTypes,
  type AuditLogEntry,
} from "@/lib/db/queries/dashboard";
import { AuditFilter } from "@/components/settings/audit-filter";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: { entity?: string; cursor?: string };
}) {
  const { account } = await getCurrentAccountAndUser();

  const [entityTypes, entries] = await Promise.all([
    listAuditEntityTypes(account.id),
    listAuditEntries(account.id, {
      entityType: searchParams.entity,
      cursor: searchParams.cursor ? new Date(searchParams.cursor) : undefined,
      limit: PAGE_SIZE,
    }),
  ]);

  const nextCursor =
    entries.length === PAGE_SIZE
      ? entries[entries.length - 1]?.createdAt.toISOString()
      : undefined;

  const nextQuery = nextCursor
    ? `?${new URLSearchParams({
        ...(searchParams.entity ? { entity: searchParams.entity } : {}),
        cursor: nextCursor,
      }).toString()}`
    : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Audit log</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every change to subscriptions, renewals, account settings, and
            preferences is recorded here.
          </p>
        </div>
        <AuditFilter entityTypes={entityTypes} />
      </header>

      {entries.length === 0 ? (
        <div className="rounded-md border bg-white p-10 text-center text-sm text-muted-foreground">
          No audit entries match this filter.
        </div>
      ) : (
        <div className="rounded-md border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2">When</th>
                <th className="text-left font-medium px-4 py-2">Actor</th>
                <th className="text-left font-medium px-4 py-2">Action</th>
                <th className="text-left font-medium px-4 py-2">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((row) => (
                <AuditRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextQuery && (
        <div className="flex justify-center pt-2">
          <Link
            href={`/settings/audit${nextQuery}`}
            className="inline-flex items-center justify-center rounded-md border bg-white px-4 py-2 text-sm hover:bg-muted/40"
          >
            Older entries →
          </Link>
        </div>
      )}
    </div>
  );
}

function AuditRow({ row }: { row: AuditLogEntry }) {
  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {row.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
      </td>
      <td className="px-4 py-2.5">
        {row.actorName ?? row.actorEmail ?? (
          <span className="text-muted-foreground italic">system</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          {row.action}
        </code>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {row.targetEntityType ?? "—"}
        {row.targetEntityId && (
          <span className="ml-2 font-mono text-[10px] opacity-70">
            {row.targetEntityId.slice(0, 8)}
          </span>
        )}
      </td>
    </tr>
  );
}

