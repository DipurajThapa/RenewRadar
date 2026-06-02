import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { provisionNewUser } from "@server/application/auth/provision";
import { SeatLimitExceededError } from "@server/application/invitations";
import { archiveUser } from "@server/application/users/archive";
import { db } from "@server/infrastructure/db/client";
import { usersTable } from "@server/infrastructure/db/schema";
import { createLogger } from "@server/infrastructure/observability/logger";

export const runtime = "nodejs";

const log = createLogger({ component: "webhooks.clerk" });

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    log.error("clerk_webhook_secret_unset");
    return new Response("Server misconfigured", { status: 500 });
  }

  // Read headers from the Request directly so the route is unit-testable
  // with a synthetic Request (next/headers needs an active request scope).
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.text();

  // `new Webhook(secret)` eagerly base64-decodes the secret and THROWS on a
  // malformed value. Constructed outside try/catch it turned a misconfigured
  // secret into an uncaught 500 (empty body) on every delivery — and a forged
  // request into a 500 instead of a clean 401. Construct it under guard:
  // a bad secret is a server misconfig (500, labeled), a bad signature is a
  // rejected request (401).
  let wh: Webhook;
  try {
    wh = new Webhook(webhookSecret);
  } catch (err) {
    log.error("clerk_webhook_secret_invalid", err);
    return new Response("Server misconfigured", { status: 500 });
  }

  let event: WebhookEvent;
  try {
    event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    log.error("clerk_signature_verification_failed", err, { svixId });
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    switch (event.type) {
      case "user.created": {
        const { id, email_addresses, first_name, last_name } = event.data;
        const primaryEmail = email_addresses.find(
          (e) => e.id === event.data.primary_email_address_id
        );
        if (!primaryEmail) {
          return new Response("No primary email", { status: 400 });
        }

        // Pull the optional invitation token from Clerk's unsafe_metadata.
        // The /invitations/[token] page sets it via the sign-up URL; Clerk
        // exposes it back on user.created.
        const metadata =
          (event.data.unsafe_metadata as Record<string, unknown> | undefined) ??
          {};
        const rawToken = metadata.invitation_token;
        const invitationToken =
          typeof rawToken === "string" && rawToken.length > 0 ? rawToken : null;

        await provisionNewUser({
          clerkUserId: id,
          email: primaryEmail.email_address,
          fullName: [first_name, last_name].filter(Boolean).join(" ") || null,
          invitationToken,
        });
        break;
      }

      case "user.updated": {
        const { id, email_addresses, first_name, last_name } = event.data;
        const primaryEmail = email_addresses.find(
          (e) => e.id === event.data.primary_email_address_id
        );

        const fullName =
          [first_name, last_name].filter(Boolean).join(" ") || null;
        const newEmail = primaryEmail?.email_address;

        const updates: Record<string, unknown> = { fullName };
        if (newEmail) updates.workEmail = newEmail;

        await db
          .update(usersTable)
          .set(updates)
          .where(eq(usersTable.clerkUserId, id));
        break;
      }

      case "user.deleted": {
        const clerkUserId = event.data.id;
        if (!clerkUserId) break;
        // P7.2 — never hard delete. Move the row to user_archive so
        // historical audit-log FKs keep resolving and the data is
        // available for re-signup detection / GDPR audit reconstruction.
        // archiveUser is idempotent: re-deliveries from Clerk are safe.
        const [existing] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.clerkUserId, clerkUserId))
          .limit(1);
        if (existing) {
          const result = await archiveUser({
            userId: existing.id,
            reason: "clerk_user_deleted",
            archivedByUserId: null,
          });
          if (!result.ok) {
            log.error("clerk_user_archive_failed", undefined, {
              clerkUserId,
              error: result.error,
            });
            return new Response(result.error, { status: 500 });
          }
          log.info("clerk_user_archived", { clerkUserId, userId: existing.id });
        } else {
          log.info("clerk_user_deleted_not_in_db", { clerkUserId });
        }
        break;
      }

      default:
        log.info("clerk_event_unhandled", { type: event.type });
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    // Seat-cap denial is not a transient error — return 422 so Clerk doesn't
    // retry. The user's Clerk account exists but no DB row was created; they
    // will hit /setup-pending indefinitely. The /invitations/[token] page
    // pre-checks the cap to make this race vanishingly rare in normal flow.
    if (err instanceof SeatLimitExceededError) {
      log.warn("clerk_provision_seat_cap_exceeded", { message: err.message });
      return new Response(err.message, { status: 422 });
    }
    log.error("clerk_handler_failed", err, { eventType: event.type });
    return new Response("Processing error", { status: 500 });
  }
}
