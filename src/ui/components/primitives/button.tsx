import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@shared/utils";

/**
 * Button — full variant set, sized for a modern density.
 *
 * Variants:
 *   default     filled indigo, used for primary CTAs
 *   secondary   neutral slate fill, used for second-tier actions
 *   outline     hairline bordered, white fill
 *   ghost       transparent until hover, used in toolbars/menus
 *   subtle      indigo-tinted soft surface, used for in-card CTAs
 *   destructive red fill
 *   link        inline text-style action
 *
 * Sizes are slightly taller than shadcn defaults to feel intentional next
 * to inputs and to fit Inter's optical sizing.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium select-none transition-[background-color,color,box-shadow,transform] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-card hover:bg-primary-strong",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/60",
        outline:
          "border border-input bg-background text-foreground hover:bg-secondary hover:text-secondary-foreground",
        subtle:
          "bg-primary-soft text-primary-strong hover:bg-primary-soft/70",
        ghost: "text-foreground hover:bg-secondary",
        destructive:
          "bg-destructive text-destructive-foreground shadow-card hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-[13px]",
        default: "h-10 px-4 py-2",
        lg: "h-11 rounded-md px-6 text-[15px]",
        xl: "h-12 rounded-md px-7 text-base",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
