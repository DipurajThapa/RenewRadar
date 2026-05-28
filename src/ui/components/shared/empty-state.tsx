import { Card, CardContent } from "@ui/components/primitives/card";
import { cn } from "@shared/utils";

/**
 * Generic empty-state card with optional icon, title, body, and a CTA slot.
 *
 * Use this wherever a list, table, or dashboard surface has no data to show
 * yet. Replaces ad-hoc inline empty-state cards in the subscriptions list,
 * notice-deadlines page, renewals page, dashboard, etc.
 *
 * @example
 *   <EmptyState
 *     icon={<Inbox className="h-8 w-8" />}
 *     title="No subscriptions yet"
 *     description="Add your first to start tracking notice deadlines."
 *     action={<Button>Add subscription</Button>}
 *   />
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "default",
  className,
}: {
  /** Decorative icon shown above the title. Optional. */
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** "success" turns the icon green ("✓ all clear" pattern) */
  variant?: "default" | "success";
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent
        className={cn("text-center space-y-3", action ? "py-12" : "py-16")}
      >
        {icon && (
          <div
            className={cn(
              "mx-auto flex h-12 w-12 items-center justify-center rounded-full",
              variant === "success"
                ? "bg-green-100 text-green-700"
                : "bg-muted text-muted-foreground"
            )}
            aria-hidden
          >
            {icon}
          </div>
        )}
        <p className="text-lg font-medium">{title}</p>
        {description && (
          <div className="text-sm text-muted-foreground max-w-md mx-auto">
            {description}
          </div>
        )}
        {action && <div className="pt-2">{action}</div>}
      </CardContent>
    </Card>
  );
}
