/**
 * Lock-state gate for over-capacity accounts.
 *
 * When a Stripe webhook downgrades a tier and leaves the account over the
 * new caps (e.g. Pro→Starter with 500 subscriptions vs the 50 cap), we
 * set `accounts.lockState = "over_capacity"`. Reads continue to work so
 * the customer can decide what to delete; writes refuse with a clear
 * "upgrade or clean up" error.
 *
 * This module is the canonical gate. Server actions check it before
 * mutating. The check is cheap — single column read on the already-loaded
 * account row — so we don't memoize it.
 */
import {
  TIER_DEFINITIONS,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";
import type { Account } from "@server/infrastructure/db/schema";

export class AccountLockedError extends Error {
  readonly state: "over_capacity";
  constructor(state: "over_capacity", message: string) {
    super(message);
    this.name = "AccountLockedError";
    this.state = state;
  }
}

/**
 * Throw AccountLockedError when the account is in a write-blocking lock
 * state. Call at the top of every mutating server action after the
 * role + tier gates.
 *
 * Returns void on success so it composes naturally with `requireRole` and
 * `requireTierFeature`.
 */
export function requireAccountWritable(account: Account): void {
  if (account.lockState === "over_capacity") {
    throw new AccountLockedError(
      "over_capacity",
      `Your account exceeds the ${TIER_DEFINITIONS[account.planTier as PlanTier].label} ` +
        `tier limits. Upgrade or remove old subscriptions/documents before creating new ones. ` +
        `Reads are unaffected.`
    );
  }
}

/**
 * Compute whether an account should be locked given its current row counts
 * vs its tier caps. Used by:
 *   - Stripe webhook on downgrade to decide if we should set the lock
 *   - A periodic sweep (future) to unlock accounts that fell back under
 *     the cap after the user deleted data
 *
 * Pure — no DB calls.
 */
export function shouldLockForCapacity(input: {
  planTier: PlanTier;
  currentSubscriptions: number;
  currentUsers: number;
  currentStorageBytes: number;
}): boolean {
  const limits = TIER_DEFINITIONS[input.planTier].limits;
  if (
    Number.isFinite(limits.maxSubscriptions) &&
    input.currentSubscriptions > limits.maxSubscriptions
  )
    return true;
  if (
    Number.isFinite(limits.maxUsers) &&
    input.currentUsers > limits.maxUsers
  )
    return true;
  if (
    Number.isFinite(limits.maxStorageBytes) &&
    input.currentStorageBytes > limits.maxStorageBytes
  )
    return true;
  return false;
}
