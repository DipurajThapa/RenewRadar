import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@ui/components/primitives/badge";
import { Card } from "@ui/components/primitives/card";
import { AuthorByline } from "@ui/features/blog/author-byline";
import { LeadCaptureForm } from "@ui/features/marketing/lead-capture-form";
import {
  ArticleJsonLd,
  BreadcrumbJsonLd,
} from "@ui/components/seo/structured-data";
import {
  getBlogPost,
  listBlogPosts,
  listBlogSlugs,
} from "@server/infrastructure/blog";

/**
 * Pre-render every post at build time so the static output is fully cacheable.
 */
export async function generateStaticParams() {
  const slugs = await listBlogSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  try {
    const post = await getBlogPost(params.slug);
    const canonical = `/blog/${post.slug}`;
    return {
      title: post.title,
      description: post.description,
      authors: [{ name: post.author.name }],
      keywords: post.tags as string[],
      alternates: { canonical },
      openGraph: {
        title: post.title,
        description: post.description,
        url: canonical,
        type: "article",
        publishedTime: post.publishedAt,
        modifiedTime: post.updatedAt,
        authors: [post.author.name],
        tags: post.tags as string[],
      },
      twitter: {
        card: "summary_large_image",
        title: post.title,
        description: post.description,
      },
    };
  } catch {
    return { title: "Post not found" };
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: { slug: string };
}) {
  let post;
  try {
    post = await getBlogPost(params.slug);
  } catch {
    notFound();
  }

  // Three most recent posts that aren't this one — used for the "Keep reading"
  // block. Listing posts again is cheap (filesystem read at build time).
  const all = await listBlogPosts();
  const related = all.filter((p) => p.slug !== post.slug).slice(0, 3);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: post.title, href: `/blog/${post.slug}` },
        ]}
      />
      <ArticleJsonLd
        headline={post.title}
        description={post.description}
        datePublished={post.publishedAt}
        dateModified={post.updatedAt}
        url={`/blog/${post.slug}`}
      />

      <article className="relative">
        {/* Hero — same gradient backdrop as the marketing HeroBanner so the
            blog visually belongs to the marketing surface. */}
        <header className="relative overflow-hidden pt-14 lg:pt-20 pb-10">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-primary-soft via-background to-background"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[420px] bg-grid bg-grid-fade opacity-50"
          />
          <div className="relative max-w-3xl mx-auto px-5 lg:px-8 space-y-6">
            <Link
              href="/blog"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All posts
            </Link>
            <div className="flex flex-wrap gap-2">
              {post.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-[-0.02em] leading-[1.08]">
              {post.title}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {post.description}
            </p>
            <AuthorByline
              author={post.author}
              publishedAt={post.publishedAt}
              updatedAt={
                post.updatedAt !== post.publishedAt ? post.updatedAt : undefined
              }
              readingTimeMinutes={post.readingTimeMinutes}
            />
          </div>
        </header>

        {/* Body — `prose` from @tailwindcss/typography handles long-form
            markdown styling. We constrain the column to ~64ch for readability. */}
        <div className="max-w-3xl mx-auto px-5 lg:px-8 pb-12 lg:pb-16">
          <div
            className="prose prose-neutral prose-sm sm:prose-base max-w-none prose-headings:font-display prose-headings:tracking-tight prose-a:text-primary-strong prose-a:no-underline hover:prose-a:underline prose-code:before:hidden prose-code:after:hidden prose-code:bg-secondary prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-normal prose-code:text-foreground/85 prose-pre:bg-secondary/70 prose-pre:text-foreground/90 prose-pre:border prose-pre:border-border/60 prose-blockquote:border-l-primary prose-blockquote:bg-primary-soft/40 prose-blockquote:py-1 prose-blockquote:not-italic prose-blockquote:rounded-r-md"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />
        </div>

        {/* Author block — repeats the byline with a richer treatment so
            the EEAT "Person" signal lands at the bottom of the article too. */}
        <div className="max-w-3xl mx-auto px-5 lg:px-8 pb-14">
          <AuthorByline variant="block" author={post.author} />
        </div>

        {/* Lead capture — second-best conversion event after clicking a CTA
            inside the post. Keep it inline + short. */}
        <div className="max-w-3xl mx-auto px-5 lg:px-8 pb-16">
          <Card className="p-6 sm:p-7 shadow-card-lg border-primary/15">
            <LeadCaptureForm
              source="marketing_blog_post_footer"
              intent="newsletter"
              heading="Get future posts in your inbox"
              description="Roughly one a month. Unsubscribe any time."
              submitLabel="Subscribe"
              successHeading="You're in."
              successMessage="The next post lands in your inbox when it's published."
              defaultConsent
            />
          </Card>
        </div>

        {related.length > 0 && (
          <div className="bg-secondary/30 border-t border-border/60">
            <div className="max-w-5xl mx-auto px-5 lg:px-8 py-14 space-y-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Keep reading
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {related.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/blog/${p.slug}`}
                    className="group"
                  >
                    <Card interactive className="p-5 h-full flex flex-col">
                      <div className="flex flex-wrap gap-2 mb-2">
                        {p.tags.slice(0, 2).map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </div>
                      <h3 className="font-semibold text-sm leading-snug tracking-tight group-hover:text-primary-strong transition-colors">
                        {p.title}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-2 flex-1">
                        {p.description}
                      </p>
                      <div className="mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground tabular-nums">
                        {p.readingTimeMinutes} min ·{" "}
                        <time dateTime={p.publishedAt}>{p.publishedAt}</time>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </article>
    </>
  );
}
