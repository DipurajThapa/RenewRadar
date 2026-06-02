import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { isDemoMode } from "@server/middleware/demo-mode";
import {
  OrganizationJsonLd,
  WebsiteJsonLd,
} from "@ui/components/seo/structured-data";
import "./globals.css";

/**
 * Typography:
 *   - `sans`    Inter — used everywhere.
 *   - `display` Inter limited to heavier weights — used by hero/section
 *     headings via `font-display` (defined in tailwind.config.ts).
 */
const interSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const interDisplay = Inter({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["600", "700", "800"],
});

/**
 * Site-wide metadata. Per-page metadata under the marketing group extends or
 * overrides these — Next.js merges automatically.
 *
 * `metadataBase` is required for OG/Twitter image URLs to resolve correctly.
 * In dev it falls back to localhost; in production it uses the deployed URL
 * from `NEXT_PUBLIC_APP_URL`.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Renewal Radar — Never miss a SaaS notice deadline again",
    template: "%s · Renewal Radar",
  },
  description:
    "Track every SaaS subscription, hit every notice deadline, and turn each renewal into a logged decision with savings attached. The advisor, never the agent.",
  applicationName: "Renewal Radar",
  authors: [{ name: "Renewal Radar" }],
  creator: "Renewal Radar",
  publisher: "Renewal Radar",
  keywords: [
    "SaaS renewal management",
    "subscription tracking",
    "notice deadline alerts",
    "SaaS cost optimization",
    "vendor renewal",
    "contract management",
    "Vendr alternative",
    "Sastrify alternative",
    "Tropic alternative",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteUrl,
    title: "Renewal Radar — Never miss a SaaS notice deadline again",
    description:
      "Track every SaaS subscription, hit every notice deadline, draft the cancellation letter — you click send.",
    siteName: "Renewal Radar",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Renewal Radar",
    description:
      "Track every SaaS subscription, hit every notice deadline, draft the cancellation letter — you click send.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
};

/**
 * Mobile viewport tuning. `viewportFit=cover` lets hero gradients run under
 * notches on iOS. `themeColor` matches the indigo brand so the iOS status
 * bar tints correctly when added to the home screen.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // In demo mode auth is fully bypassed (see middleware/demo-mode) — mounting
  // ClerkProvider with the placeholder publishable key triggers a stream of
  // failed clerk.example.com network requests on every page, polluting the
  // console and wasting bandwidth. Skip the provider entirely; the demo build
  // never calls a Clerk client hook.
  const tree = (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${interSans.variable} ${interDisplay.variable}`}
    >
      <body className="font-sans">
        {children}
        {/*
         * Site-wide structured data: Organization + WebSite. These are the
         * EEAT primitives that show up on every page — author/publisher
         * identification, language, contact pathways. Page-specific schemas
         * (FAQ, Article, HowTo, Breadcrumb) are emitted by individual pages.
         */}
        <OrganizationJsonLd />
        <WebsiteJsonLd />
      </body>
    </html>
  );
  return isDemoMode ? tree : <ClerkProvider>{tree}</ClerkProvider>;
}
