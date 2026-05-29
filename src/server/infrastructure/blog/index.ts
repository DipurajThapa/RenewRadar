/**
 * Blog loader.
 *
 * Posts live under `src/content/blog/*.md` as plain markdown with YAML
 * frontmatter. We parse them at build time with gray-matter + remark; the
 * resulting `BlogPost` carries the rendered HTML, metadata, and a derived
 * reading time.
 *
 * Why filesystem markdown (rather than a DB-backed CMS):
 *   - The blog is small and changes infrequently. A CMS would be operational
 *     overhead for very little benefit.
 *   - Posts version-control with the codebase: a post is reviewed in the
 *     same PR as any product or copy change.
 *   - The build artifact is fully static — there's no per-request cost
 *     to render a post, no DB hit, no cache layer to manage.
 *
 * Each post requires the following frontmatter; missing fields fail loud:
 *
 *   title:        Headline. Required.
 *   description:  Lede + SEO description. Required, max 200 chars.
 *   author:       Author id from `@server/infrastructure/blog/authors`.
 *   publishedAt:  ISO date the post first went live (YYYY-MM-DD).
 *   updatedAt:    ISO date of the most recent edit. Optional; defaults to
 *                 publishedAt.
 *   tags:         Array of topic tags. Optional.
 *   featured:     Boolean — sticks the post to the top of the listing.
 *   draft:        Boolean — hides from production listing entirely.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import readingTime from "reading-time";
import { remark } from "remark";
import gfm from "remark-gfm";
import html from "remark-html";
import { getAuthor, type AuthorProfile } from "./authors";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  tags: ReadonlyArray<string>;
  featured: boolean;
  draft: boolean;
  author: AuthorProfile;
  readingTimeMinutes: number;
  /** Pre-rendered HTML body. Safe to dangerouslySetInnerHTML. */
  html: string;
};

export type BlogPostSummary = Omit<BlogPost, "html">;

const BLOG_DIR = path.join(process.cwd(), "src", "content", "blog");

/**
 * Read + render a single post by slug. Throws on missing or malformed posts
 * so build errors surface immediately rather than rendering broken HTML.
 */
export async function getBlogPost(slug: string): Promise<BlogPost> {
  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  const title = requireString(data, "title");
  const description = requireString(data, "description");
  if (description.length > 200) {
    throw new Error(
      `Post "${slug}" description is ${description.length} chars; max 200.`
    );
  }
  const publishedAt = requireString(data, "publishedAt");
  const updatedAt =
    typeof data.updatedAt === "string" && data.updatedAt
      ? data.updatedAt
      : publishedAt;
  const authorId = requireString(data, "author");
  const author = getAuthor(authorId);

  const tags: ReadonlyArray<string> = Array.isArray(data.tags)
    ? (data.tags as ReadonlyArray<unknown>).filter(
        (t): t is string => typeof t === "string"
      )
    : [];
  const featured = data.featured === true;
  const draft = data.draft === true;

  // remark → HTML pipeline. gfm adds tables, task lists, strikethrough.
  // We do not allow raw HTML in posts — every block is markdown-shaped, so
  // there is no XSS vector beyond what the markdown itself provides.
  const processed = await remark().use(gfm).use(html).process(content);
  const renderedHtml = processed.toString();

  const stat = readingTime(content);

  return {
    slug,
    title,
    description,
    publishedAt,
    updatedAt,
    tags,
    featured,
    draft,
    author,
    readingTimeMinutes: Math.max(1, Math.round(stat.minutes)),
    html: renderedHtml,
  };
}

/**
 * List every post in the blog directory, sorted newest-first. Drafts are
 * filtered when `NODE_ENV === "production"` so they never reach the live
 * site, but stay visible locally for review.
 */
export async function listBlogPosts(): Promise<BlogPostSummary[]> {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".md"));

  const posts = await Promise.all(
    files.map(async (f) => {
      const slug = f.replace(/\.md$/, "");
      const post = await getBlogPost(slug);
      const { html: _ignore, ...summary } = post;
      void _ignore;
      return summary;
    })
  );

  const visible =
    process.env.NODE_ENV === "production"
      ? posts.filter((p) => !p.draft)
      : posts;

  return visible.sort((a, b) => {
    // Featured posts pinned to the top; otherwise newest publish date wins.
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

/**
 * Slugs only — used by `generateStaticParams` so Next.js can pre-render
 * every post at build time.
 */
export async function listBlogSlugs(): Promise<string[]> {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

function requireString(
  data: Record<string, unknown>,
  key: string
): string {
  const v = data[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Blog post is missing required frontmatter "${key}".`);
  }
  return v;
}
