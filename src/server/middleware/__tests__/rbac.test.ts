import { describe, expect, it } from "vitest";
import { ForbiddenError, hasRole, requireRole } from "@server/middleware/rbac";
import type { User } from "@server/infrastructure/db/schema";

function userWithRole(role: User["role"]): User {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    accountId: "00000000-0000-0000-0000-000000000000",
    clerkUserId: "clerk_test",
    workEmail: "test@example.com",
    fullName: "Test",
    role,
    notificationPrefs: {},
    createdAt: new Date(),
    lastLoginAt: null,
  } as User;
}

describe("rbac.requireRole", () => {
  it("allows owner for any required role", () => {
    const u = userWithRole("owner");
    expect(() => requireRole(u, "owner")).not.toThrow();
    expect(() => requireRole(u, "admin")).not.toThrow();
    expect(() => requireRole(u, "member")).not.toThrow();
    expect(() => requireRole(u, "viewer")).not.toThrow();
  });

  it("denies member when owner is required", () => {
    const u = userWithRole("member");
    expect(() => requireRole(u, "owner")).toThrow(ForbiddenError);
  });

  it("denies viewer for anything above viewer", () => {
    const u = userWithRole("viewer");
    expect(() => requireRole(u, "member")).toThrow(ForbiddenError);
    expect(() => requireRole(u, "admin")).toThrow(ForbiddenError);
    expect(() => requireRole(u, "owner")).toThrow(ForbiddenError);
    expect(() => requireRole(u, "viewer")).not.toThrow();
  });

  it("admin can do anything except owner-only things", () => {
    const u = userWithRole("admin");
    expect(() => requireRole(u, "admin")).not.toThrow();
    expect(() => requireRole(u, "member")).not.toThrow();
    expect(() => requireRole(u, "owner")).toThrow(ForbiddenError);
  });
});

describe("rbac.hasRole (boolean variant)", () => {
  it("matches requireRole's allow/deny decisions", () => {
    const samples: Array<[User["role"], User["role"], boolean]> = [
      ["owner", "owner", true],
      ["admin", "owner", false],
      ["member", "admin", false],
      ["viewer", "member", false],
      ["viewer", "viewer", true],
      ["admin", "member", true],
    ];
    for (const [have, need, expected] of samples) {
      expect(hasRole(userWithRole(have), need)).toBe(expected);
    }
  });
});
