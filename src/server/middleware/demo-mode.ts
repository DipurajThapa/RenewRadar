/**
 * Local-review demo mode.
 *
 * When DEMO_MODE=true (and we're NOT in production), the app:
 *   - Bypasses Clerk authentication entirely
 *   - Auto-signs the user in as the seeded demo account
 *   - Displays a persistent banner so demo data is never confused for real
 *
 * Strict production safety: double-checks NODE_ENV !== "production".
 * Even if someone sets DEMO_MODE=true in a production env, this guard
 * blocks the bypass.
 *
 * Demo account/user UUIDs are pinned so the seed script and the
 * current-user resolver agree on which row to return.
 */

export const isDemoMode =
  process.env.DEMO_MODE === "true" &&
  process.env.NODE_ENV !== "production";

export const DEMO_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";
export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000002";

// Synthetic Clerk user ID for the demo seed. Real Clerk IDs start with `user_`
// followed by 27 base-58 chars (e.g. `user_2abcDEF...`). Using a `__demo__`
// prefix means this ID can never collide with anything Clerk emits, even
// across all instances and ID generation epochs.
export const DEMO_CLERK_USER_ID = "__demo__synthetic_user_do_not_match";
