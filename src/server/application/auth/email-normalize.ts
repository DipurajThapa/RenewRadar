/**
 * Email normalization for free-tier abuse dedup.
 *
 * The audit's M1 finding: `user+1@gmail.com` creates a fresh free account
 * over and over because Clerk verifies the literal email. Same with case
 * variants (`User@Gmail.com` vs `user@gmail.com`).
 *
 * The normalization here is conservative — it matches Gmail/Google Workspace
 * canonicalization rules (which are well-documented) and lowercases for
 * everyone else. We do NOT strip `+` tags for non-Gmail providers because
 * many corporate providers treat `+` literally; collapsing them would
 * incorrectly merge two different real users.
 *
 * The output of `normalizeEmailForDedup` is ONLY used for free-tier
 * signup dedup. The displayed email is always the user's original input.
 */

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Normalize an email address into a stable key for free-tier dedup.
 *
 * Rules:
 *   - Always lowercase
 *   - Strip surrounding whitespace
 *   - For Gmail: strip `+tag` AND strip `.` from the local part (Gmail's
 *     own canonicalization treats `john.doe+work@gmail.com` and
 *     `johndoe@gmail.com` as the same user)
 *   - For other providers: just lowercase
 */
export function normalizeEmailForDedup(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIdx = trimmed.lastIndexOf("@");
  if (atIdx < 1 || atIdx === trimmed.length - 1) return trimmed;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);

  if (GMAIL_DOMAINS.has(domain)) {
    // Strip +tag and dots, then normalize to gmail.com (googlemail = gmail)
    const stripped = local.split("+")[0]!.replace(/\./g, "");
    return `${stripped}@gmail.com`;
  }

  return trimmed;
}

/**
 * Pull the domain portion (lowercased) for free-vs-paid heuristics. Used
 * to detect generic webmail providers (where a fresh free-tier signup is
 * suspicious by default) vs. work email domains (where it's normal).
 */
export function emailDomain(email: string): string {
  const idx = email.lastIndexOf("@");
  if (idx < 0) return "";
  return email.slice(idx + 1).trim().toLowerCase();
}
