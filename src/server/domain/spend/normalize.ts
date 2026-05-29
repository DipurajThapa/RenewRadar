/**
 * Wedge PoC — merchant normalization for the spend feed.
 *
 * [H1] We do NOT author a third vendor-name normalizer. The card feed adds
 * processor noise ("RAMP *NOTION LABS", "SQ *BLUE BOTTLE") that the canonical
 * `normalizeVendorName` doesn't strip, so we add a THIN pre-clean and then
 * delegate to the canonical function. Reconciliation builds a two-key lookup
 * (canonical key + raw subscriptionMatchKey grain) so feed merchants still
 * match existing subscriptions.
 */
import { normalizeVendorName } from "@server/application/vendor-benchmarks/normalize";

/**
 * Strip card-processor prefixes and trailing reference noise from a raw
 * merchant string before canonical normalization.
 *   "RAMP *NOTION LABS"  → "NOTION LABS"
 *   "SQ *BLUE BOTTLE #42" → "BLUE BOTTLE"
 *   "TST* SOME VENDOR"    → "SOME VENDOR"
 */
export function stripProcessorPrefix(raw: string): string {
  let s = raw.trim();
  // Leading "<PROCESSOR> *" — a short alnum token followed by a star.
  s = s.replace(/^[A-Za-z0-9]{2,8}\s*\*\s*/, "");
  // Trailing store/reference "#1234" tokens.
  s = s.replace(/\s+#\d+\s*$/, "");
  return s.trim();
}

/** Canonical merchant key for grouping + reconciliation. Delegates to the
 *  repo-canonical `normalizeVendorName` after the thin pre-clean. */
export function spendMerchantKey(rawMerchant: string): string {
  return normalizeVendorName(stripProcessorPrefix(rawMerchant));
}

/** Display name from a normalized key: "notion labs" → "Notion Labs". */
export function suggestedVendorNameFromKey(key: string): string {
  return key
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
