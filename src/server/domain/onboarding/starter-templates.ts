/**
 * Industry starter templates (T3.6).
 *
 * Curated lists of "what a typical company at this stage pays for" so a new
 * customer can self-select the SaaS they use from a checklist instead of
 * typing 30 vendor names by hand. Each selected row is created as a draft
 * (status='draft' via createSubscriptionDraft) so the user can finish the
 * details (term dates, exact seat count) when they have time.
 *
 * Numbers are conservative starting estimates — the user is expected to
 * edit them. We deliberately don't claim "average for your industry" — the
 * cross-account benchmark aggregator (vendor-benchmarks/) will power that
 * in a future iteration once there's enough opted-in tenant data.
 *
 * Why static and not data-driven (yet):
 *   - The benchmark aggregator needs MIN_BENCHMARK_SAMPLE=3 contributing
 *     accounts before it'll show numbers. Early-stage we'd ship empty.
 *   - The "common vendor catalog" doesn't change month to month — Slack,
 *     Notion, Figma, Google Workspace are the perennials.
 *   - A static list lets us ship a tested, curated experience in v1 and
 *     evolve to "your peer benchmark says…" later without changing the UI
 *     contract.
 */

export type StarterTemplateProfile = "startup_small" | "startup_growth" | "enterprise_it";

export type StarterTemplateItem = {
  /** Stable id used as the checkbox key and the API payload key. */
  key: string;
  vendor: string;
  product: string;
  /** Conservative annual cost estimate (USD), per typical company at the profile size. */
  annualUsd: number;
  /** Short category for UI grouping. */
  category:
    | "Productivity"
    | "Communication"
    | "Development"
    | "Design"
    | "Marketing"
    | "Sales"
    | "Finance"
    | "Security"
    | "Infrastructure"
    | "Customer support"
    | "HR";
  /** Optional note shown in small text under the row. */
  note?: string;
};

export type StarterTemplate = {
  profile: StarterTemplateProfile;
  label: string;
  description: string;
  items: StarterTemplateItem[];
};

const STARTUP_SMALL: StarterTemplate = {
  profile: "startup_small",
  label: "SaaS startup · 5–20 people",
  description:
    "Pre-seed to seed-stage tooling. Focused on shipping the product and talking to customers.",
  items: [
    // Productivity
    { key: "google-workspace-small", vendor: "Google", product: "Google Workspace Business", annualUsd: 1_440, category: "Productivity", note: "$12/user/mo, 10 seats" },
    { key: "notion-team-small", vendor: "Notion", product: "Notion Team", annualUsd: 2_400, category: "Productivity", note: "$10/user/mo, 20 seats" },
    // Communication
    { key: "slack-pro-small", vendor: "Slack", product: "Slack Pro", annualUsd: 2_004, category: "Communication", note: "$8.35/user/mo, 20 seats" },
    { key: "zoom-pro-small", vendor: "Zoom", product: "Zoom Pro", annualUsd: 1_800, category: "Communication" },
    // Development
    { key: "github-team-small", vendor: "GitHub", product: "GitHub Team", annualUsd: 960, category: "Development", note: "$4/user/mo, 20 seats" },
    { key: "linear-standard-small", vendor: "Linear", product: "Linear Standard", annualUsd: 1_920, category: "Development" },
    { key: "vercel-pro-small", vendor: "Vercel", product: "Vercel Pro", annualUsd: 2_400, category: "Development", note: "$20/user/mo, 10 seats" },
    { key: "sentry-team-small", vendor: "Sentry", product: "Sentry Team", annualUsd: 312, category: "Development" },
    // Design
    { key: "figma-pro-small", vendor: "Figma", product: "Figma Professional", annualUsd: 1_080, category: "Design", note: "$15/editor/mo, 6 editors" },
    // Infrastructure
    { key: "aws-small", vendor: "Amazon Web Services", product: "AWS (production)", annualUsd: 12_000, category: "Infrastructure", note: "Variable usage" },
    { key: "cloudflare-pro-small", vendor: "Cloudflare", product: "Cloudflare Pro", annualUsd: 240, category: "Infrastructure" },
    // Customer support
    { key: "intercom-essential-small", vendor: "Intercom", product: "Intercom Essential", annualUsd: 4_788, category: "Customer support" },
    // Finance
    { key: "stripe-fees-small", vendor: "Stripe", product: "Stripe processing", annualUsd: 0, category: "Finance", note: "Per-transaction; track for renewal context" },
    { key: "qbooks-small", vendor: "Intuit", product: "QuickBooks Online", annualUsd: 600, category: "Finance" },
    // Security
    { key: "1password-business-small", vendor: "1Password", product: "1Password Business", annualUsd: 1_920, category: "Security", note: "$8/user/mo, 20 seats" },
  ],
};

const STARTUP_GROWTH: StarterTemplate = {
  profile: "startup_growth",
  label: "SaaS startup · 20–100 people",
  description: "Series A/B. Sales, marketing, customer success, and IT all start to need their own tooling.",
  items: [
    // Productivity
    { key: "google-workspace-growth", vendor: "Google", product: "Google Workspace Business Plus", annualUsd: 12_240, category: "Productivity", note: "$18/user/mo, 60 seats" },
    { key: "notion-business-growth", vendor: "Notion", product: "Notion Business", annualUsd: 10_800, category: "Productivity" },
    // Communication
    { key: "slack-business-growth", vendor: "Slack", product: "Slack Business+", annualUsd: 9_660, category: "Communication" },
    { key: "zoom-business-growth", vendor: "Zoom", product: "Zoom Business", annualUsd: 6_000, category: "Communication" },
    { key: "loom-business-growth", vendor: "Loom", product: "Loom Business", annualUsd: 3_000, category: "Communication" },
    // Development
    { key: "github-enterprise-growth", vendor: "GitHub", product: "GitHub Enterprise", annualUsd: 12_600, category: "Development" },
    { key: "linear-business-growth", vendor: "Linear", product: "Linear Business", annualUsd: 8_640, category: "Development" },
    { key: "vercel-enterprise-growth", vendor: "Vercel", product: "Vercel Enterprise", annualUsd: 25_000, category: "Development" },
    { key: "sentry-business-growth", vendor: "Sentry", product: "Sentry Business", annualUsd: 960, category: "Development" },
    { key: "datadog-pro-growth", vendor: "Datadog", product: "Datadog Pro", annualUsd: 18_000, category: "Development" },
    // Design
    { key: "figma-org-growth", vendor: "Figma", product: "Figma Organization", annualUsd: 5_400, category: "Design" },
    // Sales
    { key: "hubspot-pro-growth", vendor: "HubSpot", product: "HubSpot Sales Pro", annualUsd: 14_400, category: "Sales" },
    { key: "apollo-pro-growth", vendor: "Apollo", product: "Apollo Pro", annualUsd: 5_940, category: "Sales" },
    { key: "gong-growth", vendor: "Gong", product: "Gong", annualUsd: 19_800, category: "Sales" },
    // Marketing
    { key: "mixpanel-growth", vendor: "Mixpanel", product: "Mixpanel Growth", annualUsd: 9_000, category: "Marketing" },
    { key: "hubspot-mkt-growth", vendor: "HubSpot", product: "Marketing Hub Pro", annualUsd: 10_800, category: "Marketing" },
    // Customer support
    { key: "intercom-pro-growth", vendor: "Intercom", product: "Intercom Pro", annualUsd: 18_000, category: "Customer support" },
    { key: "zendesk-suite-growth", vendor: "Zendesk", product: "Zendesk Suite Pro", annualUsd: 13_800, category: "Customer support" },
    // Finance
    { key: "ramp-growth", vendor: "Ramp", product: "Ramp Plus", annualUsd: 0, category: "Finance", note: "Free; track for vendor benchmarks" },
    { key: "netsuite-growth", vendor: "Oracle NetSuite", product: "NetSuite", annualUsd: 30_000, category: "Finance" },
    // HR
    { key: "rippling-growth", vendor: "Rippling", product: "Rippling Core", annualUsd: 5_400, category: "HR" },
    { key: "lattice-growth", vendor: "Lattice", product: "Lattice", annualUsd: 7_200, category: "HR" },
    // Security
    { key: "1password-growth", vendor: "1Password", product: "1Password Business", annualUsd: 5_760, category: "Security" },
    { key: "vanta-growth", vendor: "Vanta", product: "Vanta SOC 2", annualUsd: 11_000, category: "Security" },
    // Infrastructure
    { key: "aws-growth", vendor: "Amazon Web Services", product: "AWS (production)", annualUsd: 120_000, category: "Infrastructure", note: "Variable usage" },
    { key: "cloudflare-business-growth", vendor: "Cloudflare", product: "Cloudflare Business", annualUsd: 2_400, category: "Infrastructure" },
  ],
};

const ENTERPRISE_IT: StarterTemplate = {
  profile: "enterprise_it",
  label: "Enterprise IT · 100+ people",
  description: "Standard enterprise stack. Identity, security review, procurement, and compliance tools are mandatory.",
  items: [
    // Productivity
    { key: "ms365-enterprise", vendor: "Microsoft", product: "Microsoft 365 E5", annualUsd: 72_000, category: "Productivity", note: "$57/user/mo, 100 seats" },
    { key: "google-workspace-enterprise", vendor: "Google", product: "Google Workspace Enterprise", annualUsd: 36_000, category: "Productivity" },
    // Communication
    { key: "slack-enterprise", vendor: "Slack", product: "Slack Enterprise Grid", annualUsd: 27_000, category: "Communication" },
    { key: "zoom-enterprise", vendor: "Zoom", product: "Zoom Enterprise", annualUsd: 24_000, category: "Communication" },
    // Identity / Security
    { key: "okta-enterprise", vendor: "Okta", product: "Okta Workforce Identity", annualUsd: 12_000, category: "Security" },
    { key: "1password-enterprise", vendor: "1Password", product: "1Password Enterprise", annualUsd: 12_000, category: "Security" },
    { key: "crowdstrike-enterprise", vendor: "CrowdStrike", product: "Falcon Pro", annualUsd: 24_000, category: "Security" },
    { key: "vanta-enterprise", vendor: "Vanta", product: "Vanta SOC 2 + ISO 27001", annualUsd: 25_000, category: "Security" },
    { key: "drata-enterprise", vendor: "Drata", product: "Drata Pro", annualUsd: 20_000, category: "Security" },
    // Development
    { key: "github-enterprise-enterprise", vendor: "GitHub", product: "GitHub Enterprise Cloud", annualUsd: 24_000, category: "Development" },
    { key: "datadog-enterprise-enterprise", vendor: "Datadog", product: "Datadog Enterprise", annualUsd: 60_000, category: "Development" },
    { key: "snyk-enterprise", vendor: "Snyk", product: "Snyk Enterprise", annualUsd: 30_000, category: "Development" },
    // Sales
    { key: "salesforce-enterprise", vendor: "Salesforce", product: "Sales Cloud Enterprise", annualUsd: 24_000, category: "Sales" },
    { key: "gong-enterprise", vendor: "Gong", product: "Gong Enterprise", annualUsd: 36_000, category: "Sales" },
    // Customer support
    { key: "zendesk-enterprise", vendor: "Zendesk", product: "Zendesk Suite Enterprise", annualUsd: 36_000, category: "Customer support" },
    // Finance
    { key: "netsuite-enterprise", vendor: "Oracle NetSuite", product: "NetSuite Enterprise", annualUsd: 60_000, category: "Finance" },
    { key: "coupa-enterprise", vendor: "Coupa", product: "Coupa Procurement", annualUsd: 90_000, category: "Finance" },
    // HR
    { key: "workday-enterprise", vendor: "Workday", product: "Workday HCM", annualUsd: 50_000, category: "HR" },
    // Infrastructure
    { key: "aws-enterprise", vendor: "Amazon Web Services", product: "AWS (production)", annualUsd: 500_000, category: "Infrastructure", note: "Variable usage" },
    { key: "cloudflare-enterprise", vendor: "Cloudflare", product: "Cloudflare Enterprise", annualUsd: 30_000, category: "Infrastructure" },
    // Design
    { key: "figma-enterprise", vendor: "Figma", product: "Figma Enterprise", annualUsd: 18_000, category: "Design" },
    { key: "adobe-cc-enterprise", vendor: "Adobe", product: "Creative Cloud Enterprise", annualUsd: 18_000, category: "Design" },
  ],
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  STARTUP_SMALL,
  STARTUP_GROWTH,
  ENTERPRISE_IT,
] as const;

export function getStarterTemplate(
  profile: StarterTemplateProfile
): StarterTemplate | null {
  return STARTER_TEMPLATES.find((t) => t.profile === profile) ?? null;
}
