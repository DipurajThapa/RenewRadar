import { pluralize } from "@/lib/utils";

export function DashboardGreeting({
  firstName,
  noticeNext30,
  renewalsAwaiting,
}: {
  firstName: string;
  noticeNext30: number;
  renewalsAwaiting: number;
}) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">
        {greeting}, {firstName}.
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        {new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}{" "}
        · {pluralize(noticeNext30, "notice deadline")} in next 30 days ·{" "}
        {pluralize(renewalsAwaiting, "renewal")} awaiting decision
      </p>
    </header>
  );
}
