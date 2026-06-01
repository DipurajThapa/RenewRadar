/**
 * AI-first generalization — the canonical registry for renewal-item categories.
 * Pure domain (labels + helpers only). The `subscription` row is the universal
 * "renewal item"; `category` is the discriminator. Keeping the label map a
 * Record<RenewalItemCategory> means the compiler fails CI if the enum and the
 * labels drift (same guard as VENDOR_EVENT_LABEL / TIER_FEATURE_LABEL).
 */
import type { RenewalItemCategory } from "@server/infrastructure/db/schema";

export const RENEWAL_ITEM_CATEGORY_LABEL: Record<RenewalItemCategory, string> = {
  saas_subscription: "SaaS subscription",
  software_license: "Software license",
  contract: "Contract",
  vendor_agreement: "Vendor agreement",
  insurance_policy: "Insurance policy",
  compliance_cert: "Compliance certificate",
  government_notice: "Government notice",
  domain_dns: "Domain / DNS",
  warranty_amc: "Warranty / AMC",
  professional_membership: "Professional membership",
  personal_item: "Personal item",
  other: "Other",
};

/** Display order for filters/pickers — SaaS first (the existing default), then
 *  the broader obligation types, "other" last. */
export const RENEWAL_ITEM_CATEGORIES_IN_ORDER: RenewalItemCategory[] = [
  "saas_subscription",
  "software_license",
  "contract",
  "vendor_agreement",
  "insurance_policy",
  "compliance_cert",
  "government_notice",
  "domain_dns",
  "warranty_amc",
  "professional_membership",
  "personal_item",
  "other",
];

export function renewalItemCategoryLabel(category: string): string {
  return (
    RENEWAL_ITEM_CATEGORY_LABEL[category as RenewalItemCategory] ?? category
  );
}
