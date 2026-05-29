import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { HeroBanner } from "@ui/components/shared/hero-banner";
import { AuthorByline } from "@ui/features/blog/author-byline";
import { LeadCaptureForm } from "@ui/features/marketing/lead-capture-form";
import { BreadcrumbJsonLd } from "@ui/components/seo/structured-data";
import { listBlogPosts } from "@server/infrastructure/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Renewal Radar's blog — definitional posts on SaaS notice deadlines, renewal architecture, and the principles behind the product.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Blog — Renewal Radar",
    description:
      "Posts on SaaS notice deadlines, renewal architecture, and the principles behind the product.",
    url: "/blog",
    type: "website",
  },
};

/**
 * Blog index — a marketing-grade card grid with a featured post at the top.
 *
 * The list is loaded at build time from `src/content/blog/*.md` via the
 * blog loader. Drafts are filtered in production but shown locally so
 * authors can preview before merging.
 */
export default async function BlogIndexPage() {
  const posts = await listBlogPosts();
  const featured = posts.find((p) => p.featured) ?? posts[0];
  const rest = posts.filter((p) => p.slug !== featured?.slug);

  return (
    <>
      <HeroBanner
        eyebrow="Blog"
        title="Notes on renewals, contracts, and the product."
        description="Definitional posts on how SaaS notice deadlines work, why we built the product the way we did, and the principles that keep your contract data yours."
        compact
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
        ]}
      />

      <main className="max-w-6xl mx-auto px-5 lg:px-8 pb-20 space-y-14">
        {featured && (
          <section aria-labelledby="featured-heading" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="featured-heading"
                className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              >
                Featured
              </h2>
              <Badge variant="primary-soft" className="gap-1">
                <Sparkles className="h-3 w-3" />
                {featured.readingTimeMinutes} min read
              </Badge>
            </div>
            <Link href={`/blog/${featured.slug}`} className="block group">
              <Card
                interactive
                className="overflow-hidden border-primary/15 shadow-card-lg"
              >
                <div className="grid lg:grid-cols-[1.2fr_1fr] gap-0">
                  <div className="p-7 sm:p-10 space-y-5">
                    <div className="flex flex-wrap gap-2">
                      {featured.tags.slice(0, 3).map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <h3 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight leading-tight group-hover:text-primary-strong transition-colors">
                      {featured.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {featured.description}
                    </p>
                    <AuthorByline
                      author={featured.author}
                      publishedAt={featured.publishedAt}
                      readingTimeMinutes={featured.readingTimeMinutes}
                    />
                    <div className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-strong">
                      Read the post
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                  {/* Decorative — same brand gradient that the hero uses,
                      gives the featured card visual weight without an image. */}
                  <div className="relative hidden lg:block bg-gradient-to-br from-primary-soft via-background to-secondary/40">
                    <div className="absolute inset-0 bg-grid bg-grid-fade opacity-50" />
                  </div>
                </div>
              </Card>
            </Link>
          </section>
        )}

        {rest.length > 0 && (
          <section aria-labelledby="all-heading" className="space-y-4">
            <h2
              id="all-heading"
              className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground"
            >
              All posts
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-stagger">
              {rest.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group"
                >
                  <Card interactive className="p-6 h-full flex flex-col">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {post.tags.slice(0, 2).map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <h3 className="font-semibold text-base tracking-tight leading-snug group-hover:text-primary-strong transition-colors">
                      {post.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-2 flex-1">
                      {post.description}
                    </p>
                    <div className="mt-5 pt-4 border-t border-border/60 flex items-center justify-between">
                      <AuthorByline
                        variant="compact"
                        author={post.author}
                      />
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {post.readingTimeMinutes} min ·{" "}
                        <time dateTime={post.publishedAt}>
                          {post.publishedAt}
                        </time>
                      </span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Newsletter capture — the second-most-likely conversion event on
            the blog index after clicking a post. */}
        <section className="pt-6">
          <Card className="p-6 sm:p-8 shadow-card-lg border-primary/15">
            <div className="grid md:grid-cols-[1fr_1.1fr] gap-8 lg:gap-12 items-start">
              <div className="space-y-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-primary-strong font-semibold">
                  Subscribe
                </div>
                <h2 className="font-display text-2xl font-semibold tracking-tight">
                  New posts in your inbox
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Definitional posts on renewals, vendor management, and the
                  architectural choices behind the product. About one email a
                  month. Unsubscribe any time.
                </p>
              </div>
              <LeadCaptureForm
                source="marketing_blog_index_newsletter"
                intent="newsletter"
                submitLabel="Subscribe"
                successHeading="Subscribed."
                successMessage="You'll get the next post when it lands. Roughly monthly."
                defaultConsent
              />
            </div>
          </Card>
        </section>
      </main>
    </>
  );
}
