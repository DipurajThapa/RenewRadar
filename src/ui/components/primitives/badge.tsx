import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@shared/utils";

/**
 * Badge — small status pill, used heavily in lists/tables/headers.
 *
 * The variant set is intentionally semantic (not raw colors) so we can
 * retheme later by changing the CSS variables in `globals.css` only.
 *   default      neutral indigo fill, primary status
 *   secondary    quiet slate fill, "this is metadata"
 *   outline      hairline border, transparent fill
 *   success/warning/destructive
 *                bold filled status pills
 *   success-soft/warning-soft/destructive-soft
 *                quiet, low-contrast soft pills — used in lists where many
 *                pills sit next to each other
 *   primary-soft indigo-tinted soft pill — used by feature callouts ("New")
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-tight transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border border-transparent bg-primary text-primary-foreground",
        secondary:
          "border border-transparent bg-secondary text-secondary-foreground",
        outline: "border border-border bg-transparent text-foreground",
        success:
          "border border-transparent bg-success text-success-foreground",
        "success-soft":
          "border border-success/20 bg-success-soft text-success-soft-foreground",
        warning:
          "border border-transparent bg-warning text-warning-foreground",
        "warning-soft":
          "border border-warning/20 bg-warning-soft text-warning-soft-foreground",
        destructive:
          "border border-transparent bg-destructive text-destructive-foreground",
        "destructive-soft":
          "border border-destructive/20 bg-destructive-soft text-destructive-soft-foreground",
        "primary-soft":
          "border border-primary/15 bg-primary-soft text-primary-strong",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
