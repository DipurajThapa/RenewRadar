"use server";

import { headers } from "next/headers";
import {
  captureLead,
  type CaptureLeadInput,
  type LeadIntent,
  type LeadSource,
} from "@server/application/leads";
import {
  getRateLimit,
  LEAD_CAPTURE_POLICY,
} from "@server/infrastructure/rate-limit";

/**
 * Server action used by the `LeadCaptureForm` client component.
 *
 * The narrow input shape protects the public action surface: a caller can
 * only set the fields the form actually surfaces. The action itself stamps
 * the referrer (read server-side because the browser hides it from cross-
 * origin script under some setups).
 */
export type SubmitLeadInput = {
  email: string;
  fullName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  message?: string | null;
  source: LeadSource;
  intent?: LeadIntent;
  consentMarketing?: boolean;
  honeypot?: string;
  utm?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
    pageUrl?: string;
  };
};

export type SubmitLeadResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitLeadAction(
  input: SubmitLeadInput
): Promise<SubmitLeadResult> {
  const h = headers();
  const referrer = h.get("referer") ?? undefined;

  // Rate limit by IP. Defends against:
  //   - Honeypot-bypass scripted spam (the honeypot field at the use-case
  //     layer catches dumb bots but not real spammers)
  //   - Accidental double-submit storms from a buggy frontend
  // Fail-open on adapter glitches — better to take a real lead than 429
  // a genuine user because Upstash hiccuped.
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  try {
    const decision = await getRateLimit().check(
      `lead-capture:${ip}`,
      LEAD_CAPTURE_POLICY
    );
    if (!decision.allowed) {
      return {
        ok: false,
        error: "Too many requests. Please try again in a minute.",
      };
    }
  } catch (err) {
    // Fail-open by design — see comment above.
    console.error("[submitLeadAction] rate limit check failed:", err);
  }

  const captureInput: CaptureLeadInput = {
    email: input.email,
    fullName: input.fullName ?? null,
    company: input.company ?? null,
    jobTitle: input.jobTitle ?? null,
    message: input.message ?? null,
    source: input.source,
    intent: input.intent ?? "other",
    consentMarketing: input.consentMarketing ?? false,
    honeypot: input.honeypot,
    metadata: {
      ...(input.utm ?? {}),
      referrer,
    },
  };

  const result = await captureLead(captureInput);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
