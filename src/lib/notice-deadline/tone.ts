/**
 * Single source of truth for "how urgent is this notice deadline" coloring.
 *
 * The wedge feature depends on these thresholds being consistent everywhere
 * a notice deadline is displayed — dashboard spotlight, calendar, subscription
 * detail, decide-now header, table rows. Don't reimplement this anywhere.
 *
 * Tone tiers:
 *   - missed:    deadline is in the past
 *   - critical:  ≤3 days remaining
 *   - urgent:    4–7 days
 *   - warning:   8–30 days
 *   - upcoming:  >30 days
 */

export type UrgencyTone =
  | "missed"
  | "critical"
  | "urgent"
  | "warning"
  | "upcoming";

export type UrgencyToneClasses = {
  /** Tailwind classes for a small filled dot (`bg-…-500`) */
  dot: string;
  /** Tailwind classes for foreground text */
  text: string;
  /** Tailwind classes for card/border treatments */
  border: string;
  /** Tailwind classes for background panels */
  bg: string;
  /** Short uppercase label */
  label: string;
};

const STYLES: Record<UrgencyTone, UrgencyToneClasses> = {
  missed: {
    dot: "bg-gray-500",
    text: "text-gray-700",
    border: "border-gray-400",
    bg: "bg-gray-100",
    label: "MISSED",
  },
  critical: {
    dot: "bg-red-500",
    text: "text-red-700",
    border: "border-red-300",
    bg: "bg-red-50",
    label: "ACTION NEEDED",
  },
  urgent: {
    dot: "bg-orange-500",
    text: "text-orange-700",
    border: "border-orange-300",
    bg: "bg-orange-50",
    label: "ACTION NEEDED",
  },
  warning: {
    dot: "bg-yellow-500",
    text: "text-yellow-800",
    border: "border-yellow-300",
    bg: "bg-yellow-50",
    label: "NOTICE WINDOW",
  },
  upcoming: {
    dot: "bg-blue-500",
    text: "text-blue-700",
    border: "border-gray-200",
    bg: "bg-blue-50",
    label: "UPCOMING",
  },
};

export function getUrgencyTone(daysUntilDeadline: number): UrgencyTone {
  if (daysUntilDeadline < 0) return "missed";
  if (daysUntilDeadline <= 3) return "critical";
  if (daysUntilDeadline <= 7) return "urgent";
  if (daysUntilDeadline <= 30) return "warning";
  return "upcoming";
}

export function urgencyClasses(
  daysOrTone: number | UrgencyTone
): UrgencyToneClasses {
  const tone =
    typeof daysOrTone === "number" ? getUrgencyTone(daysOrTone) : daysOrTone;
  return STYLES[tone];
}
