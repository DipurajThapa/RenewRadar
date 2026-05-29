import * as React from "react";
import { cn } from "@shared/utils";

/**
 * Card — the workhorse surface across the app.
 *
 *   <Card>                       softly elevated, no hover (default)
 *   <Card interactive>           hover lifts shadow, used for clickable rows
 *   <Card variant="ghost">       no border + no shadow; for inline grouping
 *   <Card variant="muted">       soft tinted background for callouts
 *
 * Padding is owned by `CardHeader` / `CardContent` / `CardFooter` so an
 * empty Card has zero implicit padding — important when we want a hairline
 * border around a grid of pure data rows.
 */
type CardVariant = "default" | "ghost" | "muted" | "outline";

const variantClass: Record<CardVariant, string> = {
  default: "border bg-card text-card-foreground shadow-card",
  outline: "border bg-card text-card-foreground",
  ghost: "bg-transparent",
  muted: "border border-border/60 bg-muted/40 text-card-foreground",
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /**
   * Adds a hover transition that lifts the shadow. Use on cards the user
   * can click — avoids tagging every card with "interactive" classes by hand.
   */
  interactive?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg",
        variantClass[variant],
        // `surface-lift` adds the hover lift + shadow promotion only when the
        // user hasn't opted out of motion. See globals.css.
        interactive
          ? "cursor-pointer surface-lift hover:border-border/70"
          : "transition-shadow",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-col gap-1.5 p-6 pb-4",
      className
    )}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-base font-semibold leading-tight tracking-tight",
      className
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground leading-relaxed", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center gap-2 p-6 pt-4 border-t border-border/60",
      className
    )}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
