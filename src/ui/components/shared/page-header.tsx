import * as React from "react";
import { cn } from "@shared/utils";

/**
 * PageHeader — the canonical top-of-page block.
 *
 * Every app page should start with this so titles, descriptions, breadcrumbs,
 * and primary actions land in the same place at the same size. Skipping it
 * is what makes pages feel inconsistent.
 *
 * Composition:
 *   <PageHeader>
 *     <PageHeader.Title>Documents</PageHeader.Title>
 *     <PageHeader.Description>...</PageHeader.Description>
 *     <PageHeader.Actions>
 *       <Button>Upload</Button>
 *     </PageHeader.Actions>
 *   </PageHeader>
 */
function Root({
  className,
  children,
  eyebrow,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { eyebrow?: React.ReactNode }) {
  return (
    <header className={cn("mb-8", className)} {...props}>
      {eyebrow && (
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground mb-2">
          {eyebrow}
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">{children}</div>
      </div>
    </header>
  );
}

function Title({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      className={cn(
        "font-display text-2xl sm:text-3xl font-semibold tracking-tight text-foreground",
        className
      )}
      {...props}
    />
  );
}

function Description({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-sm sm:text-base text-muted-foreground leading-relaxed max-w-2xl",
        className
      )}
      {...props}
    />
  );
}

function Actions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 sm:shrink-0",
        className
      )}
      {...props}
    />
  );
}

/**
 * Variant of PageHeader for pages that need the title + actions on the same
 * top row (with the description sitting under the whole row). Used by the
 * dashboard so the greeting and the action queue button line up.
 */
function Row({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
      {...props}
    />
  );
}

export const PageHeader = Object.assign(Root, {
  Title,
  Description,
  Actions,
  Row,
});
