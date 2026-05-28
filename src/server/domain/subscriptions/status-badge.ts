/**
 * Single source of truth for how a subscription status maps to a Badge variant.
 *
 * Used by the subscriptions list, the subscription detail page, the calendar
 * rows, and anywhere else a status pill is rendered. Don't inline this mapping.
 */

import type { Subscription } from "@server/infrastructure/db/schema";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function getStatusBadgeVariant(
  status: Subscription["status"] | string
): BadgeVariant {
  switch (status) {
    case "active":
      return "default";
    case "paused":
      return "secondary";
    case "pending_cancellation":
      return "outline";
    case "cancelled":
    case "expired":
      return "destructive";
    case "draft":
    default:
      return "outline";
  }
}

/** Human-readable status label — "pending_cancellation" → "Pending cancellation" */
export function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(" ");
}
