import type { MetadataRoute } from "next";

/**
 * robots.txt — public crawl policy.
 *
 *   - Marketing surface: allowed for everyone.
 *   - App surface (`/dashboard`, etc.): disallowed; it requires a session
 *     and would just waste crawl budget.
 *   - LLM crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.) are explicitly
 *     allowed on the marketing surface. The `/llms.txt` + `/llms-full.txt`
 *     pair is what we want them to ingest.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

  // Routes that require a session — never useful in search results, and a
  // bot hitting them just bounces through sign-in middleware. Excluded for
  // all crawlers.
  const appRoutes: string[] = [
    "/dashboard",
    "/action-queue",
    "/review-queue",
    "/approvals",
    "/documents",
    "/subscriptions",
    "/notice-deadlines",
    "/renewals",
    "/reports",
    "/vendors",
    "/settings",
    "/api/",
    "/sign-in",
    "/sign-up",
    "/invitations/",
    "/setup-pending",
  ];

  return {
    rules: [
      // Everyone — Google, Bing, etc.
      {
        userAgent: "*",
        allow: "/",
        disallow: appRoutes,
      },
      // LLM crawlers — explicit allow on marketing, explicit pointer to the
      // llms.txt files. Naming them here is itself a GEO signal: it tells
      // the agent we know it's coming and have prepared content for it.
      {
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-User",
          "anthropic-ai",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "CCBot",
          "Bytespider",
          "Applebot-Extended",
          "Meta-ExternalAgent",
        ],
        allow: ["/", "/llms.txt", "/llms-full.txt"],
        disallow: appRoutes,
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
