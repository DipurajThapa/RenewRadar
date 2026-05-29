import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ui/components/primitives/card";
import { pluralize } from "@shared/utils";
import type { Anomaly } from "@server/infrastructure/db/repositories/dashboard";

/**
 * "Things worth checking" — non-urgent but actionable items. Hidden when
 * empty so the dashboard doesn't carry a "good news: nothing to do" card
 * that just adds visual noise.
 */
export function Anomalies({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-warning-soft text-warning-soft-foreground">
            <AlertCircle className="h-4 w-4" />
          </span>
          Things worth checking
        </CardTitle>
        <CardDescription>
          Soft signals — not urgent, but worth a glance.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <ul className="divide-y divide-border/60">
          {anomalies.map((a, i) => (
            <AnomalyRow key={i} anomaly={a} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AnomalyRow({ anomaly }: { anomaly: Anomaly }) {
  const { message, href } = describe(anomaly);
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between gap-3 px-3 py-3 rounded-md hover:bg-secondary/40 transition-colors"
      >
        <span className="text-sm text-foreground/90 leading-snug">
          {message}
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function describe(a: Anomaly): { message: string; href: string } {
  switch (a.type) {
    case "auto_renew_no_decision":
      return {
        message: `${pluralize(a.count, "subscription")} auto-renew within their notice window — no decision logged yet`,
        href: "/notice-deadlines",
      };
    case "default_notice_period":
      return {
        message: `${pluralize(a.count, "subscription")} use the default 30-day notice period — confirm against your contract`,
        href: "/subscriptions",
      };
  }
}
