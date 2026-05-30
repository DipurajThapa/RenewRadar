import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import type { AgentPreppedItem } from "@server/infrastructure/db/repositories/renewals";
import { formatDate } from "@shared/utils";

/**
 * "Prepared for you" — the autonomous Renewal Agent's silent overnight work,
 * made visible. Each row is a renewal the agent has already briefed + drafted a
 * notice for; the human just reviews and decides. Nothing was sent or committed
 * — the autonomy boundary holds.
 */
export function PreparedForYou({ items }: { items: AgentPreppedItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
          Prepared for you
        </h2>
        <p className="text-sm text-muted-foreground/80">
          The renewal agent has briefed and drafted these overnight — review and
          decide.
        </p>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {items.map((item) => (
          <li key={item.subscriptionId}>
            <Link
              href={`/subscriptions/${item.subscriptionId}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {item.vendorName} — {item.productName}
                </div>
                <div className="text-xs text-muted-foreground">
                  Notice deadline {formatDate(item.noticeDeadline)}
                </div>
              </div>
              <span className="text-xs uppercase tracking-wide rounded bg-indigo-100 text-indigo-900 px-2 py-0.5 font-semibold whitespace-nowrap">
                {item.recommendedAction.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
                {item.confidencePct}%
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
