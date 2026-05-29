/**
 * T4.1 — Staff identity middleware.
 *
 * Provides `requireCurrentStaff()` for /staff routes and actions.
 *
 * Identity model:
 *   - Production: user signs in via Clerk like everyone else. If their
 *     Clerk email matches `STAFF_EMAILS` (comma-separated allowlist env
 *     var), they're auto-provisioned into `staff_user` on first access.
 *     Anyone else hitting /staff gets a 404 — staff routes don't even
 *     leak their existence.
 *   - DEMO_MODE: a fixed demo staff user is seeded (DEMO_STAFF_ID) so
 *     local development can exercise the concierge flow without standing
 *     up a separate Clerk org.
 *
 * Why not a Clerk org/role for staff:
 *   - Clerk Org features are paid-tier in production; we want this to
 *     work on the free/Hobby plan during early staffing.
 *   - The allowlist is in our control; rotating staff means updating an
 *     env var, no third-party permission.
 *
 * The `staff_user` row is the canonical identity — even if Clerk is
 * absent (tests, scripts), code that has a `staffUserId` can act.
 */
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { ensureStaffUser } from "@server/application/support-sessions";
import { isDemoMode } from "@server/middleware/demo-mode";
import { db } from "@server/infrastructure/db/client";
import { staffUsersTable, type StaffUser } from "@server/infrastructure/db/schema";
import { eq } from "drizzle-orm";

/**
 * Stable demo staff UUID — pinned so the seed script can write it and
 * `requireCurrentStaff()` can read it in DEMO_MODE.
 */
export const DEMO_STAFF_USER_ID = "00000000-0000-0000-0000-000000000010";
export const DEMO_STAFF_EMAIL = "demo-staff@renewalradar.test";

function parseStaffEmails(): Set<string> {
  const raw = process.env.STAFF_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  );
}

/**
 * Resolve the current staff identity. Throws via notFound() when the user
 * isn't a staff member — the page renders a 404, not "Access denied," so
 * non-staff can't even tell the route exists.
 */
export const requireCurrentStaff = cache(async (): Promise<StaffUser> => {
  if (isDemoMode) {
    return getOrSeedDemoStaff();
  }

  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) notFound();

  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress?.toLowerCase();
  if (!email) notFound();

  const allowlist = parseStaffEmails();
  if (!allowlist.has(email)) notFound();

  const staff = await ensureStaffUser({
    clerkUserId,
    email,
    fullName:
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null,
  });
  if (!staff.active) notFound();
  return staff;
});

/**
 * DEMO_MODE-only path. Reads (or creates on first call) the pinned demo
 * staff row. Idempotent so successive calls in the same dev session don't
 * fight on the unique-email constraint.
 */
async function getOrSeedDemoStaff(): Promise<StaffUser> {
  const [existing] = await db
    .select()
    .from(staffUsersTable)
    .where(eq(staffUsersTable.id, DEMO_STAFF_USER_ID))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(staffUsersTable)
    .values({
      id: DEMO_STAFF_USER_ID,
      email: DEMO_STAFF_EMAIL,
      fullName: "Demo Staff",
      role: "support" as const,
    })
    .returning();
  if (!created) {
    throw new Error("Failed to seed demo staff user");
  }
  return created;
}
