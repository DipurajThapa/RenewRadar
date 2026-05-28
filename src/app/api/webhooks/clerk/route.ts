import { headers } from "next/headers";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { provisionNewUser } from "@server/application/auth/provision";
import { db } from "@server/infrastructure/db/client";
import { usersTable } from "@server/infrastructure/db/schema";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SECRET is not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.text();
  const wh = new Webhook(webhookSecret);

  let event: WebhookEvent;
  try {
    event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Clerk webhook signature verification failed", err);
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
        const userId = event.data.id;
        if (!userId) break;
        await db.delete(usersTable).where(eq(usersTable.clerkUserId, userId));
        break;
      }

      default:
        // Events we don't handle yet
        console.log(`Unhandled Clerk event type: ${event.type}`);
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Clerk webhook handler error:", err);
    return new Response("Processing error", { status: 500 });
  }
}
