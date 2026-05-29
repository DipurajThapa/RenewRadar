import Script from "next/script";

/**
 * Structured data primitives.
 *
 * These are the schema.org JSON-LD blocks that drive EEAT (Experience,
 * Expertise, Authoritativeness, Trustworthiness) signals for Google and the
 * grounding signals for LLM-based search (GEO — Generative Engine
 * Optimization).
 *
 * Every JSON-LD block is rendered with `next/script` strategy="afterInteractive"
 * so it never blocks paint. Each block is given a stable `id` so React doesn't
 * remount it on re-render, and so the markup lines up with what we test.
 *
 * Why these specific schemas:
 *   - Organization      identifies the publisher with logo + contactPoint
 *   - WebSite            enables Sitelinks Search Box; declares the brand
 *   - SoftwareApplication describes the product + offers
 *   - FAQPage            promotes featured-snippet eligibility on Q&A pages
 *   - BreadcrumbList     gives sub-pages a navigable hierarchy in SERPs
 *   - Article            EEAT on long-form pages (security, DPA, etc.)
 *   - HowTo              the "How it works" 3-step content qualifies
 *
 * Reusing these primitives keeps the schema consistent — every page that
 * publishes an FAQ uses the same `FaqPageJsonLd` so the keys never drift.
 */

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

/* ─── Organization (rendered once, in the root layout) ───────────────────── */

export function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Renewal Radar",
    legalName: "Renewal Radar, Inc.",
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/icon.png`,
      width: 512,
      height: 512,
    },
    description:
      "SaaS renewal intelligence: tracks every subscription, hits every notice deadline, logs every renewal decision with savings attached.",
    foundingDate: "2026-01",
    knowsAbout: [
      "SaaS renewal management",
      "Subscription contract management",
      "Notice deadline tracking",
      "SaaS cost optimization",
      "Vendor lifecycle management",
    ],
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "hello@renewalradar.com",
        availableLanguage: ["English"],
        areaServed: "Worldwide",
      },
      {
        "@type": "ContactPoint",
        contactType: "security",
        email: "security@renewalradar.com",
        availableLanguage: ["English"],
      },
      {
        "@type": "ContactPoint",
        contactType: "privacy",
        email: "privacy@renewalradar.com",
        availableLanguage: ["English"],
      },
    ],
    sameAs: [],
  };
  return <JsonLd id="ld-organization" data={data} />;
}

/* ─── WebSite (with SearchAction stub for future Sitelinks Search Box) ──── */

export function WebsiteJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "Renewal Radar",
    url: SITE_URL,
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: "en-US",
  };
  return <JsonLd id="ld-website" data={data} />;
}

/* ─── SoftwareApplication + Offers (home / pricing) ─────────────────────── */

export function SoftwareApplicationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: "Renewal Radar",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description:
      "Track every SaaS subscription, hit every notice deadline, log every renewal decision with savings attached. The advisor, never the agent.",
    publisher: { "@id": `${SITE_URL}/#organization` },
    softwareVersion: "1.0",
    offers: [
      {
        "@type": "Offer",
        name: "Free Forever",
        price: "0",
        priceCurrency: "USD",
        url: `${SITE_URL}/pricing`,
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: "Starter",
        price: "79",
        priceCurrency: "USD",
        url: `${SITE_URL}/pricing`,
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: "Growth",
        price: "299",
        priceCurrency: "USD",
        url: `${SITE_URL}/pricing`,
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: "899",
        priceCurrency: "USD",
        url: `${SITE_URL}/pricing`,
        availability: "https://schema.org/InStock",
      },
    ],
    featureList: [
      "Notice deadline alerts at 30, 14, 7, 3, 1 days",
      "AI-extracted contract terms with evidence quotes",
      "Cancellation letter generator",
      "Renewal calendar (12-month view)",
      "Decide-Now workflow with savings ledger",
      "Multi-license per vendor",
      "Audit log + tenant isolation",
      "CSV import + export",
    ],
  };
  return <JsonLd id="ld-software" data={data} />;
}

/* ─── FAQPage — give every FAQ block a single render entry ──────────────── */

export type FaqQa = { question: string; answer: string };

export function FaqPageJsonLd({
  id = "ld-faq",
  items,
}: {
  id?: string;
  items: readonly FaqQa[];
}) {
  if (items.length === 0) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
  };
  return <JsonLd id={id} data={data} />;
}

/* ─── BreadcrumbList — for any page deeper than "/" ─────────────────────── */

export type BreadcrumbItem = { name: string; href: string };

export function BreadcrumbJsonLd({ items }: { items: readonly BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: b.name,
      item: b.href.startsWith("http") ? b.href : `${SITE_URL}${b.href}`,
    })),
  };
  return <JsonLd id="ld-breadcrumb" data={data} />;
}

/* ─── Article — long-form content (security, DPA, terms, privacy) ───────── */

export function ArticleJsonLd({
  id = "ld-article",
  headline,
  description,
  datePublished,
  dateModified,
  url,
}: {
  id?: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
  url: string;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    datePublished,
    dateModified,
    url: url.startsWith("http") ? url : `${SITE_URL}${url}`,
    publisher: { "@id": `${SITE_URL}/#organization` },
    author: { "@id": `${SITE_URL}/#organization` },
    inLanguage: "en-US",
  };
  return <JsonLd id={id} data={data} />;
}

/* ─── HowTo — "From signup to first prevented loss" steps ───────────────── */

export function HowToJsonLd({
  id = "ld-howto",
  name,
  description,
  steps,
  totalTime,
}: {
  id?: string;
  name: string;
  description: string;
  steps: ReadonlyArray<{ name: string; text: string }>;
  /** ISO 8601 duration. Example: PT30M = 30 minutes. */
  totalTime?: string;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    description,
    ...(totalTime ? { totalTime } : {}),
    step: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
  return <JsonLd id={id} data={data} />;
}

/* ─── Internal helper ───────────────────────────────────────────────────── */

function JsonLd({ id, data }: { id: string; data: object }) {
  return (
    <Script
      id={id}
      type="application/ld+json"
      strategy="afterInteractive"
      // We rely on `dangerouslySetInnerHTML` rather than `children` because
      // Next.js Script with type="application/ld+json" + children sometimes
      // gets reordered; the explicit HTML stays put.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
