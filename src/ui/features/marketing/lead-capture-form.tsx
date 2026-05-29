"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Input } from "@ui/components/primitives/input";
import { Label } from "@ui/components/primitives/label";
import { cn } from "@shared/utils";
import {
  submitLeadAction,
  type SubmitLeadInput,
} from "@app/(marketing)/lead-actions";
import type {
  LeadIntent,
  LeadSource,
} from "@server/application/leads";

/**
 * LeadCaptureForm — the single, canonical form rendered on every marketing
 * surface (home, pricing, security, blog index, individual blog posts, the
 * standalone /contact page).
 *
 * Design decision: no `variant` prop. Every caller renders the SAME shape:
 *   - Work email      (required)
 *   - Full name       (optional)
 *   - Company         (optional)
 *   - Role / title    (optional)
 *   - Message         (optional)
 *   - Consent checkbox
 *   - Submit button
 *
 * Customisable only by per-placement copy:
 *   - heading            — title above the form
 *   - description        — sub-line under the heading
 *   - submitLabel        — text on the submit button
 *   - successHeading     — title in the post-submit confirmation block
 *   - successMessage     — body in the confirmation
 *   - defaultConsent     — newsletter signups default consent=true
 *   - source / intent    — required, drive lead routing in the CRM
 *
 * Keeping the visual structure identical across the site means a visitor
 * who saw the form on the home page recognises the same form on the blog,
 * and the marketing team only has one UI to maintain. The lead row in the
 * database carries the `source` field so reporting can still distinguish
 * where each lead came from.
 */

export type LeadCaptureFormProps = {
  source: LeadSource;
  intent?: LeadIntent;
  /** Heading shown above the form. */
  heading?: string;
  /** Sub-line under the heading. */
  description?: string;
  /** Label on the submit button. */
  submitLabel?: string;
  /** Copy on the success state. */
  successHeading?: string;
  successMessage?: string;
  /** Default consent state — newsletters default true; demos default false. */
  defaultConsent?: boolean;
  className?: string;
};

export function LeadCaptureForm({
  source,
  intent = "other",
  heading,
  description,
  submitLabel = "Get started",
  successHeading = "You're on the list.",
  successMessage = "We'll be in touch within one business day. No marketing newsletters — only the follow-up you asked for.",
  defaultConsent = false,
  className,
}: LeadCaptureFormProps) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(defaultConsent);
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const utm = captureUtm();
    const payload: SubmitLeadInput = {
      email,
      fullName: fullName || null,
      company: company || null,
      jobTitle: jobTitle || null,
      message: message || null,
      source,
      intent,
      consentMarketing: consent,
      honeypot,
      utm,
    };

    startTransition(async () => {
      const result = await submitLeadAction(payload);
      if (result.ok) {
        setSucceeded(true);
      } else {
        setError(result.error);
      }
    });
  }

  if (succeeded) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "rounded-lg border border-success/20 bg-success-soft/70 px-5 py-6 sm:px-6 sm:py-7 text-success-soft-foreground",
          className
        )}
      >
        <div className="flex items-start gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-success text-success-foreground shrink-0">
            <Check className="h-4 w-4" />
          </div>
          <div className="space-y-1.5">
            <div className="font-semibold text-base tracking-tight">
              {successHeading}
            </div>
            <p className="text-sm leading-relaxed">{successMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={cn("space-y-4", className)}
    >
      {(heading || description) && (
        <div className="space-y-1.5">
          {heading && (
            <h3 className="font-display text-lg font-semibold tracking-tight">
              {heading}
            </h3>
          )}
          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
        </div>
      )}

      {/* Honeypot — visually hidden + announced as decorative.
          Anti-bot only; real users never see or focus this. */}
      <div
        aria-hidden
        className="absolute -left-[10000px] top-0 h-0 w-0 overflow-hidden"
      >
        <label htmlFor={`lc-${source}-website`}>Website</label>
        <input
          id={`lc-${source}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {/* Canonical field set — identical structure on every placement. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          label="Work email"
          htmlFor={`lc-${source}-email`}
          required
          className="sm:col-span-2"
        >
          <Input
            id={`lc-${source}-email`}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </FormField>

        <FormField label="Full name" htmlFor={`lc-${source}-name`}>
          <Input
            id={`lc-${source}-name`}
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Dipuraj Thapa"
          />
        </FormField>

        <FormField label="Company" htmlFor={`lc-${source}-company`}>
          <Input
            id={`lc-${source}-company`}
            type="text"
            autoComplete="organization"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Corp"
          />
        </FormField>

        <FormField
          label="Role / title"
          htmlFor={`lc-${source}-title`}
          className="sm:col-span-2"
        >
          <Input
            id={`lc-${source}-title`}
            type="text"
            autoComplete="organization-title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="IT Director"
          />
        </FormField>

        <FormField
          label="What are you looking for?"
          htmlFor={`lc-${source}-message`}
          className="sm:col-span-2"
        >
          <textarea
            id={`lc-${source}-message`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="A short summary helps us route your message."
            className={cn(
              "flex w-full rounded-md border border-input bg-background px-3.5 py-2 text-sm shadow-card transition-[box-shadow,border-color]",
              "placeholder:text-muted-foreground/70 hover:border-foreground/20",
              "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
            )}
          />
        </FormField>

        <div className="sm:col-span-2">
          <Button
            type="submit"
            disabled={pending}
            size="lg"
            className="w-full sm:w-auto"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                {submitLabel}
                <ArrowRight />
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Consent — required for GDPR. The label phrasing is opt-in, not
          opt-out. Default state is set by the parent via defaultConsent. */}
      <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed cursor-pointer select-none">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
        />
        <span>
          Send me occasional product updates. I can unsubscribe any time.
        </span>
      </label>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/20 bg-destructive-soft px-3.5 py-2.5 text-sm text-destructive-soft-foreground"
        >
          {error}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
        By submitting, you agree to our{" "}
        <a
          href="/privacy"
          className="underline underline-offset-4 hover:text-foreground"
        >
          privacy policy
        </a>
        . We never sell your data.
      </p>
    </form>
  );
}

function FormField({
  label,
  htmlFor,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label
        htmlFor={htmlFor}
        className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
      >
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

/**
 * Pull UTM params + pageUrl from window.location. Safe to call client-side
 * only; the result is sent to the server action which adds the referrer.
 */
function captureUtm(): NonNullable<SubmitLeadInput["utm"]> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utm: NonNullable<SubmitLeadInput["utm"]> = {
    pageUrl: window.location.href,
  };
  const keys: Array<keyof NonNullable<SubmitLeadInput["utm"]>> = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ];
  for (const k of keys) {
    const v = params.get(k);
    if (v) utm[k] = v;
  }
  return utm;
}
