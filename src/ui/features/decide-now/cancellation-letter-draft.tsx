"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { Label } from "@ui/components/primitives/label";
import { Input } from "@ui/components/primitives/input";
import { formatDate } from "@shared/utils";

/**
 * The CENTERPIECE of the Decide Now flow.
 *
 * Generates a vendor cancellation letter the customer sends from their OWN
 * email client. Renewal Radar never sends to vendors on the customer's behalf —
 * that's a binding product principle.
 *
 * UX:
 *   - Customer fills in their identity (name, title, company, vendor account ID)
 *   - The subject + body update live as they type
 *   - Two send paths: "Open in my email client" (mailto:) or "Copy to clipboard"
 *   - Visible reminder that the customer is the actor
 */
export function CancellationLetterDraft(props: {
  vendorName: string;
  productName: string;
  termEndDate: string;
  vendorCancellationEmail: string | null;
  vendorCancellationUrl: string | null;
  defaultCustomerName?: string;
  defaultCompanyName?: string;
}) {
  const [recipientEmail, setRecipientEmail] = useState(
    props.vendorCancellationEmail ?? ""
  );
  const [yourName, setYourName] = useState(props.defaultCustomerName ?? "");
  const [yourTitle, setYourTitle] = useState("");
  const [yourCompany, setYourCompany] = useState(props.defaultCompanyName ?? "");
  const [accountId, setAccountId] = useState("");
  const [copied, setCopied] = useState(false);

  const subject = useMemo(
    () =>
      `Notice of Cancellation — ${props.vendorName} — ${props.productName}`,
    [props.vendorName, props.productName]
  );

  const body = useMemo(
    () =>
      generateLetterBody({
        vendorName: props.vendorName,
        productName: props.productName,
        termEndDate: props.termEndDate,
        yourName,
        yourTitle,
        yourCompany,
        accountId,
      }),
    [
      props.vendorName,
      props.productName,
      props.termEndDate,
      yourName,
      yourTitle,
      yourCompany,
      accountId,
    ]
  );

  async function copyToClipboard() {
    const fullText = `Subject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[clipboard] failed:", err);
      window.alert(
        "Couldn't write to clipboard. Select the body text manually and copy."
      );
    }
  }

  function openInMailClient() {
    const mailto = `mailto:${encodeURIComponent(
      recipientEmail
    )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="text-amber-900">
          Step 2: Cancellation letter draft
        </CardTitle>
        <p className="text-sm text-amber-800 mt-1">
          Fill in your details below. We'll generate the letter — you send it
          from your own email client. Renewal Radar never sends emails to
          vendors on your behalf.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField label="Your name" htmlFor="cld-yourName">
            <Input
              id="cld-yourName"
              value={yourName}
              onChange={(e) => setYourName(e.target.value)}
              placeholder="e.g. Dipuraj Thapa"
              className="bg-white"
            />
          </FormField>

          <FormField label="Your title" htmlFor="cld-yourTitle">
            <Input
              id="cld-yourTitle"
              value={yourTitle}
              onChange={(e) => setYourTitle(e.target.value)}
              placeholder="e.g. IT Director"
              className="bg-white"
            />
          </FormField>

          <FormField label="Your company" htmlFor="cld-yourCompany">
            <Input
              id="cld-yourCompany"
              value={yourCompany}
              onChange={(e) => setYourCompany(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="bg-white"
            />
          </FormField>

          <FormField label="Vendor account / customer ID" htmlFor="cld-accountId">
            <Input
              id="cld-accountId"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="e.g. ACME-12345"
              className="bg-white"
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField
              label="Send to (vendor's cancellation email)"
              htmlFor="cld-recipientEmail"
            >
              <Input
                id="cld-recipientEmail"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="e.g. cancellations@vendor.com"
                className="bg-white"
              />
            </FormField>
          </div>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wide text-amber-900">
            Subject
          </Label>
          <div className="mt-1 px-3 py-2 bg-white border border-amber-200 rounded-md text-sm break-words">
            {subject}
          </div>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wide text-amber-900">
            Body
          </Label>
          <pre className="mt-1 px-3 py-3 bg-white border border-amber-200 rounded-md text-xs whitespace-pre-wrap font-sans leading-relaxed max-h-96 overflow-y-auto">
            {body}
          </pre>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={openInMailClient}
            disabled={!recipientEmail}
          >
            <Mail className="mr-2 h-4 w-4" />
            Open in my email client
          </Button>
          <Button type="button" variant="outline" onClick={copyToClipboard}>
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy to clipboard
              </>
            )}
          </Button>
          {props.vendorCancellationUrl && (
            <Button type="button" variant="outline" asChild>
              <a
                href={props.vendorCancellationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Vendor cancellation page
              </a>
            </Button>
          )}
        </div>

        <p className="text-xs text-amber-900 italic pt-3 border-t border-amber-200">
          Reminder: Renewal Radar prepared this draft. We don't send emails to
          vendors on your behalf — you review, click send, and the message
          comes from you.
        </p>
      </CardContent>
    </Card>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="text-xs uppercase tracking-wide text-amber-900">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function generateLetterBody(input: {
  vendorName: string;
  productName: string;
  termEndDate: string;
  yourName: string;
  yourTitle: string;
  yourCompany: string;
  accountId: string;
}): string {
  const companyPlaceholder = input.yourCompany || "[Your Company]";
  const namePlaceholder = input.yourName || "[Your Name]";
  const titlePlaceholder = input.yourTitle || "[Your Title]";
  const accountSuffix = input.accountId
    ? ` (account/customer ID: ${input.accountId})`
    : "";

  return `To Whom It May Concern at ${input.vendorName},

This letter constitutes formal written notice that ${companyPlaceholder} will not renew our subscription to ${input.productName}, effective at the end of the current term (${formatDate(input.termEndDate)}).

This notice is being provided in accordance with the notice period specified in our agreement${accountSuffix}.

Please confirm receipt of this notice in writing and provide written confirmation that:

  1. No automatic renewal will occur on or after ${formatDate(input.termEndDate)}
  2. Final invoice (if any) and any prorated credits will be processed promptly
  3. Account access will continue uninterrupted through the end of the current term

Please direct all correspondence regarding this cancellation to:

  ${namePlaceholder}
  ${titlePlaceholder}
  ${companyPlaceholder}

Sincerely,

${namePlaceholder}
${titlePlaceholder}
${companyPlaceholder}`;
}
