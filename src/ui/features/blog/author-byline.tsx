import { Avatar, AvatarFallback } from "@ui/components/primitives/avatar";
import { cn } from "@shared/utils";
import type { AuthorProfile } from "@server/infrastructure/blog/authors";

/**
 * Author byline.
 *
 *   variant="compact"  Used in card grids — avatar + name only.
 *   variant="header"   Used at the top of a post — avatar + name + role
 *                      + published/updated dates.
 *   variant="block"    Used at the end of a post — full profile card with
 *                      bio + credentials + sameAs links.
 *
 * Every variant is server-renderable; no client state.
 */
export function AuthorByline({
  author,
  publishedAt,
  updatedAt,
  readingTimeMinutes,
  variant = "header",
  className,
}: {
  author: AuthorProfile;
  publishedAt?: string;
  updatedAt?: string;
  readingTimeMinutes?: number;
  variant?: "compact" | "header" | "block";
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-2.5", className)}>
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-[10px] bg-primary-soft text-primary-strong font-semibold">
            {author.initials}
          </AvatarFallback>
        </Avatar>
        <span className="text-xs text-muted-foreground">
          {author.name}
        </span>
      </div>
    );
  }

  if (variant === "block") {
    return (
      <aside
        className={cn(
          "rounded-lg border border-border bg-card p-5 sm:p-6 flex gap-4 sm:gap-5",
          className
        )}
      >
        <Avatar className="h-12 w-12 shrink-0 ring-2 ring-primary/10">
          <AvatarFallback className="text-sm bg-primary-soft text-primary-strong font-semibold">
            {author.initials}
          </AvatarFallback>
        </Avatar>
        <div className="space-y-2 min-w-0">
          <div>
            <div className="font-semibold tracking-tight">{author.name}</div>
            <div className="text-xs text-muted-foreground">{author.role}</div>
          </div>
          <p className="text-sm text-foreground/85 leading-relaxed">
            {author.bio}
          </p>
          {author.credentials && (
            <p className="text-xs text-muted-foreground italic leading-relaxed">
              {author.credentials}
            </p>
          )}
          {author.sameAs && author.sameAs.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-1 text-xs">
              {author.sameAs.map((href) => (
                <a
                  key={href}
                  href={href}
                  className="underline underline-offset-4 text-foreground/70 hover:text-foreground transition-colors"
                  rel="noopener"
                >
                  {linkLabel(href)}
                </a>
              ))}
            </div>
          )}
        </div>
      </aside>
    );
  }

  // header variant — used inside a post hero
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground",
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar className="h-8 w-8 ring-2 ring-primary/10">
          <AvatarFallback className="text-[11px] bg-primary-soft text-primary-strong font-semibold">
            {author.initials}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium text-foreground">{author.name}</span>
      </div>
      {(publishedAt || updatedAt) && (
        <span aria-hidden className="h-1 w-1 rounded-full bg-muted-foreground/40" />
      )}
      {publishedAt && (
        <span>
          <span className="text-xs">Published</span>{" "}
          <time dateTime={publishedAt} className="tabular-nums">
            {publishedAt}
          </time>
        </span>
      )}
      {updatedAt && updatedAt !== publishedAt && (
        <span>
          <span className="text-xs">Updated</span>{" "}
          <time dateTime={updatedAt} className="tabular-nums">
            {updatedAt}
          </time>
        </span>
      )}
      {readingTimeMinutes !== undefined && (
        <>
          <span aria-hidden className="h-1 w-1 rounded-full bg-muted-foreground/40" />
          <span className="text-xs">{readingTimeMinutes} min read</span>
        </>
      )}
    </div>
  );
}

function linkLabel(href: string): string {
  if (href.startsWith("mailto:")) return href.replace("mailto:", "Email");
  try {
    const url = new URL(href);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}
