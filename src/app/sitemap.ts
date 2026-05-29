import type { MetadataRoute } from "next";
import { listBlogPosts } from "@server/infrastructure/blog";

/**
 * Sitemap for the public marketing surface.
 *
 * Static pages are listed explicitly with hand-picked change frequencies and
 * priorities. Blog posts are appended dynamically — each post's `updatedAt`
 * becomes the `lastModified` so Google sees freshness per-post rather than
 * one site-wide timestamp.
 *
 * Authenticated routes are intentionally excluded — they require a session
 * and would just waste crawl budget.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";
  const now = new Date();

  const staticPages: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority: number;
    lastModified?: Date;
  }> = [
    { path: "/", changeFrequency: "weekly", priority: 1.0 },
    { path: "/pricing", changeFrequency: "weekly", priority: 0.9 },
    { path: "/blog", changeFrequency: "weekly", priority: 0.8 },
    { path: "/contact", changeFrequency: "monthly", priority: 0.8 },
    { path: "/security", changeFrequency: "monthly", priority: 0.7 },
    { path: "/legal/dpa", changeFrequency: "yearly", priority: 0.5 },
    { path: "/privacy", changeFrequency: "yearly", priority: 0.5 },
    { path: "/terms", changeFrequency: "yearly", priority: 0.5 },
    { path: "/llms.txt", changeFrequency: "weekly", priority: 0.4 },
    { path: "/llms-full.txt", changeFrequency: "weekly", priority: 0.4 },
  ];

  const posts = await listBlogPosts();
  const postEntries = posts.map((p) => ({
    path: `/blog/${p.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
    lastModified: new Date(p.updatedAt),
  }));

  return [...staticPages, ...postEntries].map((entry) => ({
    url: `${base}${entry.path}`,
    lastModified: entry.lastModified ?? now,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
