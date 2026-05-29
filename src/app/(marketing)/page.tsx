import type { Metadata } from "next";
import { MarketingHome } from "@ui/features/marketing/marketing-home";
import {
  FaqPageJsonLd,
  HowToJsonLd,
  SoftwareApplicationJsonLd,
} from "@ui/components/seo/structured-data";
import { HOME_FAQ } from "@ui/features/marketing/marketing-faqs";

export const metadata: Metadata = {
  // Root layout owns the default title; the home doesn't override it.
  alternates: { canonical: "/" },
};

// Both real mode and demo mode render the marketing home. Signed-in users
// can still visit /; the MarketingNav offers them an "Open dashboard" path
// rather than a forced redirect.
export default function HomePage() {
  return (
    <>
      <MarketingHome />
      {/*
       * Page-level structured data:
       *   - SoftwareApplication: lists the product and its pricing offers.
       *     Allows the SERP card to surface the price range.
       *   - HowTo: the three-step value path. Google can render this as a
       *     rich "how to" carousel for the right query.
       *   - FAQPage: the FAQ section. Each question becomes a featured
       *     snippet candidate.
       *
       * All three target distinct query intents — combining them is
       * permitted and recommended.
       */}
      <SoftwareApplicationJsonLd />
      <HowToJsonLd
        name="How to start tracking SaaS renewals with Renewal Radar"
        description="Add subscriptions, receive notice deadline alerts, and act with a generated cancellation letter — under 30 minutes from signup."
        totalTime="PT30M"
        steps={[
          {
            name: "Add your subscriptions",
            text:
              "Type in vendor, product, term dates, and price. Under 90 seconds per subscription, or import a CSV / upload a contract.",
          },
          {
            name: "We watch every deadline",
            text:
              "Renewal Radar calculates the notice deadline for every subscription and sends escalating email alerts at 30, 14, 7, 3, and 1 days before.",
          },
          {
            name: "We draft, you send",
            text:
              "When you decide to cancel, Renewal Radar generates a vendor-ready cancellation letter. You review, open it in your own email client, and send.",
          },
        ]}
      />
      <FaqPageJsonLd items={HOME_FAQ} />
    </>
  );
}
