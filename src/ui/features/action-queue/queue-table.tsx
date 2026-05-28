import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { Badge } from "@ui/components/primitives/badge";
import { cn, formatCurrency, formatDate } from "@shared/utils";
import type { ActionQueueRow } from "@server/infrastructure/db/repositories/action-queue";

const BAND_CLASSES = {
  high: "bg-red-50 text-red-900 border-red-200",
  medium: "bg-amber-50 text-amber-900 border-amber-200",
  low: "bg-gray-50 text-gray-700 border-gray-200",
} as const;

const BAND_LABEL = {
  high: "High",
  medium: "Medium",
  low: "Low",
} as const;

export function ActionQueueTable({ rows }: { rows: ActionQueueRow[] }) {
  return (
    <div className="rounded-lg border bg-white">
      <div className="hidden md:grid md:grid-cols-[0.8fr_1.8fr_0.9fr_1fr_1fr_0.9fr_auto] gap-3 px-4 py-3 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/30">
        <div>Risk</div>
        <div>Vendor — Product</div>
        <div>Owner</div>
        <div className="text-right">At stake</div>
        <div>Notice deadline</div>
        <div>Status</div>
        <div />
      </div>
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.renewalEventId}>
            <ActionQueueRowItem row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionQueueRowItem({ row }: { row: ActionQueueRow }) {
  const days = row.daysUntilNoticeDeadline;
  const daysLabel =
    days < 0
      ? `${Math.abs(days)} days overdue`
      : days === 0
        ? "today"
        : `in ${days} day${days === 1 ? "" : "s"}`;

  return (
    <Link
      href={`/subscriptions/${row.subscriptionId}/decide?event=${row.renewalEventId}`}
      className="block hover:bg-muted/30 transition-colors"
    >
      <div className="grid grid-cols-1 md:grid-cols-[0.8fr_1.8fr_0.9fr_1fr_1fr_0.9fr_auto] gap-3 px-4 py-3 items-center text-sm">
        {/* Risk band */}
        <div>
          <Badge
            variant="outline"
            className={cn(
              "border font-medium tabular-nums",
              BAND_CLASSES[row.risk.band]
            )}
          >
            {BAND_LABEL[row.risk.band]} · {row.risk.score}
          </Badge>
        </div>

        {/* Vendor + product */}
        <div className="min-w-0">
          <div className="font-medium truncate">{row.vendorName}</div>
          <div className="text-xs text-muted-foreground truncate">
            {row.productName}
            {row.planName ? ` · ${row.planName}` : ""}
          </div>
        </div>

        {/* Owner */}
        <div className="hidden md:block min-w-0">
          {row.ownerUserId ? (
            <div className="truncate text-sm">
              {row.ownerName ?? row.ownerEmail ?? "—"}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">
              Unassigned
            </div>
          )}
        </div>

        {/* At stake */}
        <div className="text-right tabular-nums hidden md:block">
          {formatCurrency(row.annualValueCents)}
          <div className="text-xs text-muted-foreground">per year</div>
        </div>

        {/* Notice deadline */}
        <div className="hidden md:block">
          <div className="tabular-nums">{formatDate(row.noticeDeadline)}</div>
          <div
            className={cn(
              "text-xs",
              days < 0
                ? "text-red-700 font-medium"
                : days <= 7
                  ? "text-amber-700 font-medium"
                  : "text-muted-foreground"
            )}
          >
            {daysLabel}
          </div>
        </div>

        {/* Renewal-event status */}
        <div className="hidden md:block">
          <span className="text-xs capitalize text-muted-foreground">
            {row.status.replace(/_/g, " ")}
          </span>
        </div>

        <div className="hidden md:flex items-center text-xs text-muted-foreground gap-2">
          <FileText className="h-3 w-3" />
          <span>Decide</span>
          <ChevronRight className="h-3 w-3" />
        </div>

        {/* Mobile summary line */}
        <div className="md:hidden flex flex-wrap items-center justify-between text-xs text-muted-foreground mt-1 gap-2">
          <span>{formatCurrency(row.annualValueCents)}/yr</span>
          <span
            className={cn(
              days < 0
                ? "text-red-700 font-medium"
                : days <= 7
                  ? "text-amber-700 font-medium"
                  : ""
            )}
          >
            Notice {daysLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
