/**
 * Role-based access control.
 *
 * V1 SaaS has 4 roles, ranked from most to least privileged:
 *
 *   owner   — billing, plan changes, team management, everything below
 *   admin   — invite/remove team members, configure integrations, everything below
 *   member  — create/edit/cancel subscriptions, log decisions
 *   viewer  — read-only
 *
 * Every mutating action that doesn't strictly need to be everyone-can-do
 * MUST call `requireRole()` at the top after `getCurrentAccountAndUser()`.
 * The helper throws — actions catch it as a generic ForbiddenError and return
 * a structured `{ ok: false, formError: "..." }` to the UI.
 */
import type { User, UserRole } from "@/lib/db/schema";

const ROLE_RANK: Record<UserRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
  viewer: 0,
};

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Throws if the user's role is below `minRole`. Returns void on success.
 *
 * The role of the User row is the source of truth — accountId is not part of
 * the check because the resolver (`getCurrentAccountAndUser`) already
 * guarantees account membership.
 */
export function requireRole(user: User, minRole: UserRole): void {
  const have = ROLE_RANK[user.role as UserRole] ?? 0;
  const need = ROLE_RANK[minRole];
  if (have < need) {
    throw new ForbiddenError(
      `${minRole} access required (you are ${user.role})`
    );
  }
}

/**
 * Boolean variant for UI conditionals — "should we render this button?"
 */
export function hasRole(user: User, minRole: UserRole): boolean {
  const have = ROLE_RANK[user.role as UserRole] ?? 0;
  const need = ROLE_RANK[minRole];
  return have >= need;
}
