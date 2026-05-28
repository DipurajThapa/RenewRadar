/**
 * Human-readable labels for notification triggers.
 *
 * Canonical source — used by the in-app feed and the settings/notifications
 * preferences form. Don't duplicate this mapping anywhere.
 */
export type NotificationTrigger =
  | "notice_window_30"
  | "notice_window_14"
  | "notice_window_7"
  | "notice_window_3"
  | "notice_window_1"
  | "notice_window_missed"
  | "renewal_90"
  | "renewal_60"
  | "renewal_30"
  | "renewal_14"
  | "renewal_7"
  | "renewal_1"
  | "weekly_digest"
  | "monthly_summary"
  | "decision_confirmation"
  | "welcome";

export const NOTIFICATION_TRIGGER_LABELS: Record<NotificationTrigger, string> = {
  notice_window_30: "Notice deadline in 30 days",
  notice_window_14: "Notice deadline in 14 days",
  notice_window_7: "Notice deadline in 7 days",
  notice_window_3: "Notice deadline in 3 days",
  notice_window_1: "Notice deadline tomorrow",
  notice_window_missed: "Notice deadline missed",
  renewal_90: "Renewal in 90 days",
  renewal_60: "Renewal in 60 days",
  renewal_30: "Renewal in 30 days",
  renewal_14: "Renewal in 14 days",
  renewal_7: "Renewal in 7 days",
  renewal_1: "Renewal tomorrow",
  weekly_digest: "Weekly digest",
  monthly_summary: "Monthly summary",
  decision_confirmation: "Decision confirmation",
  welcome: "Welcome",
};

export function notificationTriggerLabel(trigger: string): string {
  return NOTIFICATION_TRIGGER_LABELS[trigger as NotificationTrigger] ?? trigger;
}

/**
 * Triggers that cannot be muted — these are the wedge-defining alerts.
 * Mirrored in src/app/(app)/settings/notifications/actions.ts.
 */
export const LOCKED_NOTIFICATION_TRIGGERS: ReadonlySet<NotificationTrigger> =
  new Set(["notice_window_7", "notice_window_3", "notice_window_1"]);

/**
 * Resolve a user's saved channel preference for a trigger, with safe defaults.
 * Locked triggers always come back as both channels true regardless of what's
 * stored — defense in depth against a stale prefs blob.
 */
export function resolveChannelPreference(
  prefs: unknown,
  trigger: string
): { email: boolean; in_app: boolean } {
  if (LOCKED_NOTIFICATION_TRIGGERS.has(trigger as NotificationTrigger)) {
    return { email: true, in_app: true };
  }
  const map =
    prefs && typeof prefs === "object" ? (prefs as Record<string, unknown>) : {};
  const entry = map[trigger];
  if (!entry || typeof entry !== "object") {
    return { email: true, in_app: true };
  }
  const e = entry as { email?: unknown; in_app?: unknown };
  return {
    email: e.email !== false,
    in_app: e.in_app !== false,
  };
}

/**
 * Best-effort URL the in-app feed should send the user to when they click a
 * notification. Falls back to the dashboard for triggers without an obvious
 * entity destination (digests, welcome).
 */
export function notificationDestinationUrl(
  trigger: string,
  entityType: string | null,
  entityId: string | null
): string {
  if (entityType === "subscription" && entityId) {
    return `/subscriptions/${entityId}`;
  }
  if (trigger === "weekly_digest" || trigger === "monthly_summary") {
    return "/dashboard";
  }
  return "/dashboard";
}
