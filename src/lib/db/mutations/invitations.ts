import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  invitationsTable,
  usersTable,
} from "@/lib/db/schema";
import type { Invitation, UserRole } from "@/lib/db/schema";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit/write";

const INVITATION_TTL_DAYS = 14;

/**
 * Create or replace an invitation for an email address.
 *
 * Idempotent: re-inviting an email that already has a pending invitation
 * rotates the token and resets the expiry. Re-inviting an email of an already-
 * accepted user is rejected (the user is already in the account).
 */
export async function createInvitation(input: {
  accountId: string;
  actorUserId: string;
  email: string;
  role: UserRole;
}): Promise<Invitation> {
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email is required");

  return db.transaction(async (tx) => {
    // Reject if the email already belongs to a user in this account.
    const [existingUser] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.accountId, input.accountId),
          eq(usersTable.workEmail, normalizedEmail)
        )
      )
      .limit(1);
    if (existingUser) {
      throw new Error("That email already belongs to a member of this account");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);

    const [existing] = await tx
      .select()
      .from(invitationsTable)
      .where(
        and(
          eq(invitationsTable.accountId, input.accountId),
          eq(invitationsTable.email, normalizedEmail)
        )
      )
      .limit(1);

    let row: Invitation;
    if (existing) {
      const [updated] = await tx
        .update(invitationsTable)
        .set({
          role: input.role,
          token,
          expiresAt,
          acceptedAt: null,
          acceptedByUserId: null,
          invitedByUserId: input.actorUserId,
        })
        .where(eq(invitationsTable.id, existing.id))
        .returning();
      if (!updated) throw new Error("Failed to update invitation");
      row = updated;
    } else {
      const [created] = await tx
        .insert(invitationsTable)
        .values({
          accountId: input.accountId,
          email: normalizedEmail,
          role: input.role,
          token,
          expiresAt,
          invitedByUserId: input.actorUserId,
        })
        .returning();
      if (!created) throw new Error("Failed to insert invitation");
      row = created;
    }

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.invitationCreated,
      target: { entityType: "invitation", entityId: row.id },
      after: { email: row.email, role: row.role, expiresAt: row.expiresAt },
    });

    return row;
  });
}

export async function revokeInvitation(input: {
  accountId: string;
  actorUserId: string;
  invitationId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(invitationsTable)
      .where(
        and(
          eq(invitationsTable.id, input.invitationId),
          eq(invitationsTable.accountId, input.accountId)
        )
      )
      .limit(1);
    if (!existing) return;
    if (existing.acceptedAt) {
      throw new Error("Cannot revoke an already-accepted invitation");
    }

    await tx
      .delete(invitationsTable)
      .where(eq(invitationsTable.id, existing.id));

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.invitationRevoked,
      target: { entityType: "invitation", entityId: input.invitationId },
      before: { email: existing.email, role: existing.role },
    });
  });
}

/**
 * Mark an invitation as accepted by a new user. Called from the Clerk webhook
 * after the invitee completes sign-up. The caller is responsible for creating
 * the User row with the right accountId + role.
 */
export async function acceptInvitation(input: {
  invitationId: string;
  acceptedByUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(invitationsTable)
      .where(eq(invitationsTable.id, input.invitationId))
      .limit(1);
    if (!existing) throw new Error("Invitation not found");
    if (existing.acceptedAt) return; // idempotent

    await tx
      .update(invitationsTable)
      .set({
        acceptedAt: new Date(),
        acceptedByUserId: input.acceptedByUserId,
      })
      .where(eq(invitationsTable.id, input.invitationId));

    await writeAuditLog(tx, {
      accountId: existing.accountId,
      actorUserId: input.acceptedByUserId,
      action: AUDIT_ACTIONS.invitationAccepted,
      target: { entityType: "invitation", entityId: input.invitationId },
      after: { email: existing.email, role: existing.role },
    });
  });
}
