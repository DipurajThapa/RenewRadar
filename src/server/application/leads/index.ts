/**
 * Lead capture — the public, unauthenticated path for marketing-form
 * submissions.
 *
 * Why it's a use case in `application/`:
 *   - Validation lives here, not in the route handler, so a future Slack
 *     bot or signup webhook can call the same entry point.
 *   - The upsert-on-email behaviour is non-trivial — we don't want to
 *     scatter "what does a duplicate submission do?" decisions across
 *     surfaces.
 *
 * Spam posture:
 *   - The form submits a `honeypot` field that real users never see.
 *     A non-empty value means we silently accept the submission but
 *     don't write it. Silent so the bot doesn't tune around an error.
 *   - We do NOT throw on duplicate emails — we just merge in any newer
 *     fields. This keeps the form friendly when someone resubmits.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/infrastructure/db/client";
import { leadsTable } from "@server/infrastructure/db/schema";
import type { Lead } from "@server/infrastructure/db/schema";
import { pushLeadToCrm } from "@server/infrastructure/crm";

/**
 * Closed taxonomy of where the lead came from. Keeping it here (rather
 * than baking it into the column with an enum) lets the marketing team add
 * new placements without a migration. The schema's `source` column is just
 * `text` — this set is the convention.
 */
export const LEAD_SOURCES = [
  "marketing_home_final_cta",
  "marketing_home_hero",
  "marketing_pricing_enterprise",
  "marketing_security_newsletter",
  "marketing_blog_post_footer",
  "marketing_blog_index_newsletter",
  "marketing_demo_request",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_INTENTS = [
  "demo",
  "enterprise",
  "newsletter",
  "support",
  "other",
] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

const captureLeadSchema = z.object({
  email: z.string().email().max(254).trim().toLowerCase(),
  fullName: z.string().max(120).trim().optional().nullable(),
  company: z.string().max(160).trim().optional().nullable(),
  jobTitle: z.string().max(120).trim().optional().nullable(),
  message: z.string().max(2000).trim().optional().nullable(),
  source: z.enum(LEAD_SOURCES),
  intent: z.enum(LEAD_INTENTS).default("other"),
  consentMarketing: z.boolean().default(false),
  /**
   * Honeypot — should always be empty. Bots fill every field.
   * Accept any string here (including non-empty); the handler below
   * silently drops submissions where this is set, instead of returning a
   * validation error the bot could tune around.
   */
  honeypot: z.string().max(500).optional(),
  /**
   * Non-PII context for follow-up. The UI captures the visible page URL +
   * UTM params from window.location; the server adds the referrer if it
   * has one. Never include cookies, IPs, or anything identifying beyond
   * what the user explicitly typed.
   */
  metadata: z
    .object({
      utm_source: z.string().max(120).optional(),
      utm_medium: z.string().max(120).optional(),
      utm_campaign: z.string().max(120).optional(),
      utm_term: z.string().max(120).optional(),
      utm_content: z.string().max(120).optional(),
      pageUrl: z.string().max(2048).optional(),
      referrer: z.string().max(2048).optional(),
    })
    .optional(),
});

export type CaptureLeadInput = z.input<typeof captureLeadSchema>;
export type CaptureLeadResult =
  | { ok: true; lead: Lead }
  | { ok: false; error: string };

export class LeadCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadCaptureError";
  }
}

/**
 * Capture a lead. Upserts by email — a second submission with the same email
 * replaces nullable fields rather than appending. The returned `lead.status`
 * stays "new" on every upsert so the marketing team always sees a fresh row.
 *
 * Never throws on bot/duplicate/honeypot — returns `{ ok: true }` even when
 * the row was silently dropped (anti-spam), so the form UI shows the same
 * success state regardless.
 */
export async function captureLead(
  input: CaptureLeadInput
): Promise<CaptureLeadResult> {
  const parsed = captureLeadSchema.safeParse(input);
  if (!parsed.success) {
    // Surface a friendly, generic message — don't leak which field failed.
    return { ok: false, error: "Please check your details and try again." };
  }

  // Honeypot filled → pretend success but write nothing.
  if (parsed.data.honeypot && parsed.data.honeypot.length > 0) {
    // Generate a synthetic Lead-shaped object so the caller doesn't need to
    // special-case the bot path. The id is random, never stored, never seen.
    const phantom: Lead = {
      id: crypto.randomUUID(),
      email: parsed.data.email,
      fullName: parsed.data.fullName ?? null,
      company: parsed.data.company ?? null,
      jobTitle: parsed.data.jobTitle ?? null,
      source: parsed.data.source,
      intent: parsed.data.intent,
      message: parsed.data.message ?? null,
      status: "new",
      consentMarketing: parsed.data.consentMarketing,
      metadataJson: null,
      contactedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return { ok: true, lead: phantom };
  }

  const now = new Date();
  const baseValues = {
    email: parsed.data.email,
    fullName: parsed.data.fullName ?? null,
    company: parsed.data.company ?? null,
    jobTitle: parsed.data.jobTitle ?? null,
    source: parsed.data.source,
    intent: parsed.data.intent,
    message: parsed.data.message ?? null,
    consentMarketing: parsed.data.consentMarketing,
    metadataJson: parsed.data.metadata
      ? (parsed.data.metadata as unknown as Record<string, unknown>)
      : null,
    updatedAt: now,
  };

  try {
    const [row] = await db
      .insert(leadsTable)
      .values(baseValues)
      .onConflictDoUpdate({
        target: leadsTable.email,
        set: {
          fullName: baseValues.fullName,
          company: baseValues.company,
          jobTitle: baseValues.jobTitle,
          // Update source/intent because resubmission from a different page
          // tells us where the visitor is now, which is more useful than
          // where they first arrived.
          source: baseValues.source,
          intent: baseValues.intent,
          message: baseValues.message,
          consentMarketing: baseValues.consentMarketing,
          metadataJson: baseValues.metadataJson,
          status: "new",
          updatedAt: now,
        },
      })
      .returning();
    if (!row) {
      // Race-condition fallback: if onConflictDoUpdate produced no row, look
      // it up so we always return something coherent to the caller.
      const [existing] = await db
        .select()
        .from(leadsTable)
        .where(eq(leadsTable.email, parsed.data.email))
        .limit(1);
      if (!existing) {
        throw new LeadCaptureError("Insert and lookup both failed");
      }
      // Fire-and-forget CRM push for the existing row too — duplicate
      // submissions are real leads worth re-pushing to the CRM (Google
      // Sheets appends; HubSpot upserts on email).
      void pushLeadToCrm(toPushPayload(existing));
      return { ok: true, lead: existing };
    }
    void pushLeadToCrm(toPushPayload(row));
    return { ok: true, lead: row };
  } catch (err) {
    console.error("[captureLead] failed:", err);
    return {
      ok: false,
      error: "We couldn't save your details right now. Please try again.",
    };
  }
}

/**
 * Map a DB lead row to the CRM payload shape. Kept here (rather than in
 * the CRM layer) because the lead module owns the row → push translation.
 */
function toPushPayload(row: Lead) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    company: row.company,
    jobTitle: row.jobTitle,
    source: row.source,
    intent: row.intent,
    message: row.message,
    status: row.status,
    consentMarketing: row.consentMarketing,
    metadata:
      (row.metadataJson as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  };
}
