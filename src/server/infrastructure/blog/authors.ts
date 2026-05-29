/**
 * Author profiles — the EEAT layer for the blog.
 *
 * Every byline points at one of these. The profile carries a name, role,
 * credentials, bio, and external links so Google can attribute expertise to a
 * real person (the "E" in EEAT — Experience and Expertise).
 *
 * Adding an author:
 *   1. Add the entry below with a stable `id` (used as the slug in URLs).
 *   2. Reference the id in the post's frontmatter (`author: founders`).
 *   3. Render an `AuthorByline` from `@ui/features/blog/author-byline`.
 *
 * The profile is also emitted as a `Person` JSON-LD block on every post
 * page so the SERP can pick up "Written by …" attribution.
 */

export type AuthorProfile = {
  id: string;
  name: string;
  role: string;
  bio: string;
  /**
   * Plain initials shown in the placeholder avatar. Two characters max so
   * the avatar reads cleanly at thumbnail size.
   */
  initials: string;
  /**
   * External profile URLs. Surfaced both visually and inside the Person
   * JSON-LD as `sameAs` — they are EEAT signals because they tie the
   * author to a real, verifiable identity.
   */
  sameAs?: ReadonlyArray<string>;
  /** Short qualifying line shown under the byline. */
  credentials?: string;
};

/**
 * Single source of truth for author IDs. Adding to this map is the only
 * way to make a new byline valid — posts referencing an unknown author
 * fail loud at build.
 */
export const AUTHORS: Readonly<Record<string, AuthorProfile>> = {
  founders: {
    id: "founders",
    name: "Renewal Radar founders",
    role: "Founding team",
    initials: "RR",
    credentials:
      "Built by operators who have managed SaaS portfolios at 25–500-person companies.",
    bio:
      "We started Renewal Radar after watching a 12-person ops team spend three weeks fighting an auto-renewal nobody had calendared. The product exists to make that impossible.",
    sameAs: ["mailto:hello@renewalradar.com"],
  },
  engineering: {
    id: "engineering",
    name: "Renewal Radar engineering",
    role: "Engineering team",
    initials: "ENG",
    credentials:
      "The engineers who built the extraction, isolation, and audit-log layers.",
    bio:
      "We write about how the product works under the hood — extraction heuristics, tenant isolation, audit logging, and the architectural principles that keep customer data ours and only ours.",
    sameAs: ["mailto:security@renewalradar.com"],
  },
} as const;

export function getAuthor(id: string): AuthorProfile {
  const a = AUTHORS[id];
  if (!a) {
    throw new Error(
      `Unknown author id "${id}". Known: ${Object.keys(AUTHORS).join(", ")}`
    );
  }
  return a;
}
