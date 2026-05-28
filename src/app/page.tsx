import { MarketingHome } from "@/components/marketing/marketing-home";

// Both real mode and demo mode render the marketing home. Signed-in users
// can still visit /; the MarketingNav offers them an "Open dashboard" path
// rather than a forced redirect.
export default function HomePage() {
  return <MarketingHome />;
}
