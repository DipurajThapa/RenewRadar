import * as React from "react";
import { cn } from "@shared/utils";

/**
 * HeroBanner — the canonical top-of-landing-page block.
 *
 * Every public landing page (pricing, security, terms, privacy, DPA, etc.)
 * starts with this. Skipping it is what makes marketing pages feel
 * inconsistent.
 *
 * Composition:
 *
 *   <HeroBanner
 *     eyebrow="Security"
 *     title="Built so a single team can run it"
 *     description="..."
 *     actions={<Button …/>}
 *     metaBelow={<div>Last updated …</div>}
 *   />
 *
 * Visual treatment:
 *   - Brand-tinted gradient backdrop with dot grid
 *   - Centered content, generous vertical rhythm
 *   - Optional `align="left"` for legal pages where centred text feels off
 *   - Optional `compact` for smaller landing pages (auth, etc.)
 *
 * The component is server-safe (no client state) so it can be rendered
 * inside server-only marketing pages.
 */

export type HeroBannerProps = {
  /** Small upper-case caption above the headline. Optional. */
  eyebrow?: React.ReactNode;
  /** The headline. Required. */
  title: React.ReactNode;
  /** Sub-headline / lede. Optional but recommended. */
  description?: React.ReactNode;
  /** CTA buttons / chips. Optional. */
  actions?: React.ReactNode;
  /** Metadata rendered under everything (e.g. "Last updated 2026-05-28"). */
  metaBelow?: React.ReactNode;
  align?: "center" | "left";
  /** Compact = shorter vertical padding, smaller headline. */
  compact?: boolean;
  /** Hide the dot grid + gradient (useful for very long legal pages). */
  plain?: boolean;
  className?: string;
};

export function HeroBanner({
  eyebrow,
  title,
  description,
  actions,
  metaBelow,
  align = "center",
  compact = false,
  plain = false,
  className,
}: HeroBannerProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden",
        compact ? "pt-14 lg:pt-20 pb-10" : "pt-20 lg:pt-28 pb-14 lg:pb-20",
        className
      )}
    >
      {!plain && (
        <>
          <div
            aria-hidden
            className={cn(
              "absolute inset-x-0 top-0 bg-gradient-to-b from-primary-soft via-background to-background",
              compact ? "h-[420px]" : "h-[640px]"
            )}
          />
          <div
            aria-hidden
            className={cn(
              "absolute inset-x-0 top-0 bg-grid bg-grid-fade opacity-50",
              compact ? "h-[420px]" : "h-[640px]"
            )}
          />
        </>
      )}

      <div
        className={cn(
          "relative max-w-5xl mx-auto px-5 lg:px-8",
          align === "center" ? "text-center" : "text-left"
        )}
      >
        <div
          className={cn(
            "max-w-3xl space-y-5",
            align === "center" && "mx-auto"
          )}
        >
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-strong">
              {eyebrow}
            </div>
          )}

          <h1
            className={cn(
              "font-display font-semibold tracking-[-0.03em]",
              compact
                ? "text-3xl sm:text-4xl lg:text-[44px] leading-[1.08]"
                : "text-[40px] sm:text-5xl lg:text-[56px] leading-[1.05]"
            )}
          >
            {title}
          </h1>

          {description && (
            <p
              className={cn(
                "text-muted-foreground leading-relaxed",
                compact
                  ? "text-base sm:text-lg max-w-2xl"
                  : "text-lg sm:text-xl max-w-2xl",
                align === "center" && "mx-auto"
              )}
            >
              {description}
            </p>
          )}

          {actions && (
            <div
              className={cn(
                "flex flex-col sm:flex-row gap-3 pt-2",
                align === "center" && "justify-center"
              )}
            >
              {actions}
            </div>
          )}

          {metaBelow && (
            <div
              className={cn(
                "pt-3 text-sm text-muted-foreground",
                align === "left" ? "" : "max-w-xl mx-auto"
              )}
            >
              {metaBelow}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
