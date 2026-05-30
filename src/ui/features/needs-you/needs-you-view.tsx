import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  CheckSquare,
  ClipboardCheck,
  FileSearch,
  Inbox,
} from "lucide-react";
import type { NeedsYouQueue, NeedsYouItem } from "@server/application/needs-you";
import type { NeedsYouType } from "@server/domain/needs-you/rank";
import { formatCurrency } from "@shared/utils";

const TYPE_META: Record<
  NeedsYouType,
  { label: string; icon: React.ComponentType<{ className?: string }>; chip: string }
> = {
  renewal: { label: "Renewals", icon: ClipboardCheck, chip: "bg-amber-100 text-amber-800" },
  review: { label: "Reviews", icon: FileSearch, chip: "bg-sky-100 text-sky-800" },
  approval: { label: "Approvals", icon: CheckSquare, chip: "bg-violet-100 text-violet-800" },
  request: { label: "Requests", icon: Inbox, chip: "bg-teal-100 text-teal-800" },
  spend: { label: "Spend", icon: Banknote, chip: "bg-emerald-100 text-emerald-800" },
};

const TYPES: NeedsYouType[] = ["renewal", "review", "approval", "request", "spend"];

export function NeedsYouView({
  queue,
  activeType,
}: {
  queue: NeedsYouQueue;
  activeType: NeedsYouType | "all";
}) {
  const filtered =
    activeType === "all"
      ? queue.items
      : queue.items.filter((i) => i.type === activeType);

  return (
    <div className="space-y-5">
      {/* Type filters — links that set ?type=, RSC-friendly, no client state. */}
      <div className="flex flex-wrap gap-2">
        <FilterChip
          href="/action-queue"
          active={activeType === "all"}
          label="All"
          count={queue.items.length}
        />
        {TYPES.map((t) => (
          <FilterChip
            key={t}
            href={`/action-queue?type=${t}`}
            active={activeType === t}
            label={TYPE_META[t].label}
            count={queue.countsByType[t]}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground px-1">
          Nothing in this category needs you right now.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {filtered.map((item) => (
            <NeedsYouRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors " +
        (active
          ? "border-foreground bg-foreground text-background"
          : "border-border hover:bg-muted")
      }
    >
      {label}
      <span
        className={
          "tabular-nums text-xs rounded-full px-1.5 " +
          (active ? "bg-background/20" : "bg-muted")
        }
      >
        {count}
      </span>
    </Link>
  );
}

function NeedsYouRow({ item }: { item: NeedsYouItem }) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
      >
        <span
          className={
            "inline-flex h-8 w-8 items-center justify-center rounded-md shrink-0 " +
            meta.chip
          }
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{item.title}</div>
          <div className="text-xs text-muted-foreground truncate">
            {item.subtitle}
          </div>
        </div>
        {item.valueCents != null && item.valueCents > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
            {formatCurrency(item.valueCents)}
          </span>
        )}
        <span
          className="h-1.5 w-12 rounded-full bg-muted overflow-hidden shrink-0"
          title={`Urgency ${item.urgencyScore}/100`}
          aria-label={`Urgency ${item.urgencyScore} of 100`}
        >
          <span
            className="block h-full bg-foreground/70"
            style={{ width: `${item.urgencyScore}%` }}
          />
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </Link>
    </li>
  );
}
