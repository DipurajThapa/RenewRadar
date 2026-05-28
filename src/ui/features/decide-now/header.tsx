import { cn, daysUntil, formatCurrency, formatDate } from "@shared/utils";
import {
  getUrgencyTone,
  urgencyClasses,
  type UrgencyTone,
} from "@server/domain/notice-deadline/tone";

export function DecideNowHeader({
  vendorName,
  productName,
  noticeDeadline,
  annualValueCents,
}: {
  vendorName: string;
  productName: string;
  noticeDeadline: string;
  annualValueCents: number;
}) {
  const days = daysUntil(noticeDeadline);
  const tone = getUrgencyTone(days);
  const styles = urgencyClasses(tone);
  // High-contrast text variant for use against tone.bg.
  const darkText = darkerTextClass(tone);
  // The decide-now context uses sentence-case labels (more readable here than
  // the all-caps shouting style we use on table/calendar rows).
  const label = headerLabel(tone);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">{vendorName}</p>
        <h1 className="text-2xl font-semibold mt-1">{productName}</h1>
      </div>

      <div
        className={cn("rounded-lg border-2 p-4", styles.bg, styles.border)}
      >
        <div
          className={cn(
            "text-xs uppercase tracking-wide font-semibold",
            darkText
          )}
        >
          {label}
        </div>
        <div className={cn("text-2xl font-bold mt-1", darkText)}>
          {days >= 0
            ? `Notice deadline in ${days} day${days === 1 ? "" : "s"}`
            : `Notice deadline ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`}
        </div>
        <div className="text-sm mt-1">
          {formatDate(noticeDeadline)} ·{" "}
          <span className="font-medium">
            {formatCurrency(annualValueCents)}/year at stake
          </span>{" "}
          if you do nothing
        </div>
      </div>
    </div>
  );
}

// Higher-contrast text for the colored-background header card.
function darkerTextClass(tone: UrgencyTone): string {
  switch (tone) {
    case "critical":
      return "text-red-900";
    case "urgent":
      return "text-orange-900";
    case "warning":
      return "text-yellow-900";
    case "missed":
      return "text-gray-900";
    case "upcoming":
    default:
      return "text-blue-900";
  }
}

function headerLabel(tone: UrgencyTone): string {
  switch (tone) {
    case "missed":
      return "MISSED";
    case "critical":
      return "Final days";
    case "urgent":
      return "Action needed";
    case "warning":
      return "Notice window";
    case "upcoming":
    default:
      return "Upcoming";
  }
}
