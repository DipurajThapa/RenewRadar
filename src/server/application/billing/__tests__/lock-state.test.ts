/**
 * Lock-state gate tests — over-capacity write block.
 *
 * Two layers:
 *   1. Pure `shouldLockForCapacity` math against tier limits
 *   2. `requireAccountWritable` throws AccountLockedError on locked accounts
 */
import { describe, expect, it } from "vitest";
import {
  AccountLockedError,
  requireAccountWritable,
  shouldLockForCapacity,
} from "@server/application/billing/lock-state";
import type { Account } from "@server/infrastructure/db/schema";

const baseAccount: Account = {
  id: "acc-test",
  name: "Test",
  billingEmail: "t@example.com",
  planTier: "starter",
  trialStartedAt: null,
  trialExpiresAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  pastDueSince: null,
  lockState: null,
  timezone: "UTC",
  requireApprovals: false,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Account;

describe("shouldLockForCapacity", () => {
  it("returns false when usage is under every cap", () => {
    expect(
      shouldLockForCapacity({
        planTier: "starter",
        currentSubscriptions: 5,
        currentUsers: 1,
        currentStorageBytes: 1024,
      })
    ).toBe(false);
  });

  it("returns true when subscriptions exceed the cap", () => {
    // Starter cap is 50.
    expect(
      shouldLockForCapacity({
        planTier: "starter",
        currentSubscriptions: 51,
        currentUsers: 1,
        currentStorageBytes: 0,
      })
    ).toBe(true);
  });

  it("returns true when users exceed the cap", () => {
    // Starter cap is 3.
    expect(
      shouldLockForCapacity({
        planTier: "starter",
        currentSubscriptions: 1,
        currentUsers: 4,
        currentStorageBytes: 0,
      })
    ).toBe(true);
  });

  it("returns true when storage exceeds the cap", () => {
    // Starter cap is 2 GB.
    expect(
      shouldLockForCapacity({
        planTier: "starter",
        currentSubscriptions: 1,
        currentUsers: 1,
        currentStorageBytes: 3 * 1024 * 1024 * 1024,
      })
    ).toBe(true);
  });

  it("never locks enterprise (infinite caps)", () => {
    expect(
      shouldLockForCapacity({
        planTier: "enterprise",
        currentSubscriptions: 1_000_000,
        currentUsers: 1_000,
        currentStorageBytes: 10 * 1024 * 1024 * 1024 * 1024, // 10 TB
      })
    ).toBe(false);
  });
});

describe("requireAccountWritable", () => {
  it("returns void when lockState is null", () => {
    expect(() =>
      requireAccountWritable({ ...baseAccount, lockState: null })
    ).not.toThrow();
  });

  it("throws AccountLockedError when lockState is 'over_capacity'", () => {
    try {
      requireAccountWritable({ ...baseAccount, lockState: "over_capacity" });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AccountLockedError);
      const e = err as AccountLockedError;
      expect(e.state).toBe("over_capacity");
      expect(e.message).toMatch(/exceeds|upgrade|remove/i);
    }
  });

  it("error message mentions the current plan label for the upgrade nudge", () => {
    try {
      requireAccountWritable({
        ...baseAccount,
        planTier: "pro",
        lockState: "over_capacity",
      });
      expect.fail("expected throw");
    } catch (err) {
      const e = err as AccountLockedError;
      expect(e.message).toMatch(/Pro/);
    }
  });
});
