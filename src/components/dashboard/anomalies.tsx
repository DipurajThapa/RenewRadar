import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pluralize } from "@/lib/utils";
import type { Anomaly } from "@/lib/db/queries/dashboard";

export function Anomalies({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Things worth checking</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {anomalies.map((a, i) => (
          <AnomalyRow key={i} anomaly={a} />
        ))}
      </CardContent>
    </Card>
  );
}

function AnomalyRow({ anomaly }: { anomaly: Anomaly }) {
  const { message, href } = describe(anomaly);
  return (
    <Link
      href={href}
      className="flex items-center gap-3 py-2 px-2 -mx-2 hover:bg-muted/30 rounded-md transition-colors"
    >
      <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0" />
      <span className="text-sm flex-1">{message}</span>
      <span className="text-sm text-muted-foreground">→</span>
    </Link>
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
