/**
 * Vendor-name normalization for cross-account benchmarking.
 *
 * Real vendor names in the wild carry inconsistent casing, whitespace, and
 * corporate suffixes ("Atlassian Inc.", "atlassian", "Atlassian "). For
 * benchmarking to find a meaningful sample size of customers who use the
 * same vendor, we need to collapse those variants to a single key.
 *
 * NEVER use this key as a display label — it's a stripped-down identifier.
 * Always display the vendor's original `name` field.
 */

/**
 * Common corporate suffixes we strip before comparison. Sorted longest-
 * first so multi-word suffixes match before single-word ones (e.g. "co inc"
 * before "inc"). Lowercase + punctuation-stripped on the input side too.
 */
const CORPORATE_SUFFIXES: readonly string[] = [
  "incorporated",
  "corporation",
  "limited",
  "company",
  "co inc",
  "llc",
  "ltd",
  "inc",
  "co",
  "gmbh",
  "ag",
  "sa",
  "bv",
  "nv",
  "kk",
  "plc",
];

/**
 * Normalize a vendor name to a stable benchmark key.
 *
 * Steps:
 *   1. Lowercase
 *   2. Strip control chars + non-ASCII (preserve ASCII letters/digits/space)
 *   3. Collapse internal whitespace to single space + trim
 *   4. Strip trailing corporate suffix tokens (Inc/LLC/Ltd/etc.)
 *   5. Re-trim
 *
 * Empty / pure-whitespace input returns "" — the caller MUST treat empty
 * as "no benchmark available."
 */
export function normalizeVendorName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.toLowerCase();
  // Replace punctuation + non-printable with a space, then collapse.
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";

  // Walk corporate suffixes from longest to shortest; remove if present at
  // the END of the string. Repeat once to handle "Foo Inc. LLC" → "foo".
  for (let pass = 0; pass < 2; pass++) {
    let stripped = false;
    for (const suffix of CORPORATE_SUFFIXES) {
      if (s === suffix) {
        // The whole name is just a suffix — degenerate input, can't
        // meaningfully normalize.
        return "";
      }
      if (s.endsWith(" " + suffix)) {
        s = s.slice(0, -suffix.length - 1).trim();
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }

  return s;
}
