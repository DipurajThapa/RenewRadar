import * as React from "react";
import { cn } from "@shared/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Input — a hair taller than shadcn default (h-10), with a softer hairline,
 * a hover ring on the border, and a refined focus state that matches the
 * brand. Used everywhere; rarely overridden.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3.5 py-2 text-sm shadow-card transition-[box-shadow,border-color]",
          "placeholder:text-muted-foreground/70",
          "hover:border-foreground/20",
          "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
