import { cn } from "@shared/utils";
import {
  getUrgencyTone,
  urgencyClasses,
  type UrgencyTone,
} from "@server/domain/notice-deadline/tone";

/**
 * Standardized urgency indicator: small colored dot + uppercase label.
 *
 * Used in the dashboard spotlight, the notice deadline calendar, and the
 * decide-now header. Pass either a `daysUntilDeadline` number or an explicit
 * `tone` — the component looks up the canonical color + label automatically.
 */
export function UrgencyPill({
  daysUntilDeadline,
  tone: explicitTone,
  /** Optional override for the label (otherwise the canonical "ACTION NEEDED" / "NOTICE WINDOW" etc.) */
  label,
  className,
}: {
  daysUntilDeadline?: number;
  tone?: UrgencyTone;
  label?: string;
  className?: string;
}) {
  const tone =
    explicitTone ??
    (daysUntilDeadline !== undefined
      ? getUrgencyTone(daysUntilDeadline)
      : "upcoming");
  const styles = urgencyClasses(tone);

  return (
    <span
      className={cn("inline-flex items-center gap-2 text-xs", className)}
    >
      <span
        className={cn("h-2 w-2 rounded-full shrink-0", styles.dot)}
        aria-hidden
      />
      <span
        className={cn("uppercase tracking-wide font-medium", styles.text)}
      >
        {label ?? styles.label}
      </span>
    </span>
  );
}

/** Just the dot — useful inline next to a vendor name */
export function UrgencyDot({
  daysUntilDeadline,
  tone: explicitTone,
  className,
}: {
  daysUntilDeadline?: number;
  tone?: UrgencyTone;
  className?: string;
}) {
  const tone =
    explicitTone ??
    (daysUntilDeadline !== undefined
      ? getUrgencyTone(daysUntilDeadline)
      : "upcoming");
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 rounded-full shrink-0",
        urgencyClasses(tone).dot,
        className
      )}
      aria-hidden
    />
  );
}
