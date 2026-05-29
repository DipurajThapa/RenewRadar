/**
 * RSS 2.0 feed for the blog at /blog/rss.xml.
 *
 * RSS is still the de-facto subscription standard for technical readers and
 * the way readers like Reeder, Feedly, and Inoreader discover updates.
 * We emit a feed with the most recent N posts; clients poll on their own
 * cadence.
 *
 * The feed is served as `application/rss+xml` with a short cache window so
 * a reader hitting the endpoint right after a post lands sees the new entry.
 */
import { listBlogPosts } from "@server/infrastructure/blog";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

const MAX_ITEMS = 25;

export async function GET() {
  const posts = (await listBlogPosts()).slice(0, MAX_ITEMS);
  const now = new Date().toUTCString();

  const items = posts
    .map((post) => {
      const url = `${APP_URL}/blog/${post.slug}`;
      const pubDate = new Date(post.publishedAt).toUTCString();
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <author>hello@renewalradar.com (${escapeXml(post.author.name)})</author>
      <description>${escapeXml(post.description)}</description>
${post.tags.map((t) => `      <category>${escapeXml(t)}</category>`).join("\n")}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Renewal Radar</title>
    <link>${APP_URL}/blog</link>
    <atom:link href="${APP_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Posts on SaaS notice deadlines, renewal architecture, and the principles behind the product.</description>
    <language>en-US</language>
    <lastBuildDate>${now}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
