"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, RefreshCw } from "lucide-react";
import {
  checkVerificationAction,
  startVerificationAction,
} from "@app/vendor/verify-domain/actions";

/**
 * T4.10 Slice 2 — DNS verification widget.
 *
 * Shows the TXT record the vendor must publish and a "Check now" button.
 * Polls only on demand (button) — no background polling, to keep it simple
 * and avoid hammering DNS.
 */
export function DomainVerifier({
  initialHost,
  initialValue,
  initialVerified,
}: {
  initialHost: string;
  initialValue: string;
  initialVerified: boolean;
}) {
  const [host, setHost] = useState(initialHost);
  const [value, setValue] = useState(initialValue);
  const [verified, setVerified] = useState(initialVerified);
  const [message, setMessage] = useState<string | null>(null);
  const [observed, setObserved] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function start() {
    startTransition(async () => {
      setMessage(null);
      const r = await startVerificationAction();
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      setHost(r.host);
      setValue(r.expectedValue);
      setVerified(r.alreadyVerified);
    });
  }

  function check() {
    startTransition(async () => {
      setMessage(null);
      setObserved(null);
      const r = await checkVerificationAction();
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      if (r.verified) {
        setVerified(true);
        router.refresh();
      } else {
        setObserved(r.observed);
        setMessage(
          "We didn't find the record yet. DNS can take a few minutes to propagate — try again shortly."
        );
      }
    });
  }

  if (verified) {
    return (
      <div className="rounded-lg border border-teal-300 bg-teal-50 p-5 flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-teal-700 mt-0.5" />
        <div>
          <div className="font-medium text-teal-900">Domain verified</div>
          <p className="text-sm text-teal-900/70">
            Your account is active. Customers will see a verified badge next to
            your announcements.
          </p>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="rounded-md bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 text-sm font-medium"
      >
        {pending ? "Starting…" : "Start domain verification"}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <p className="text-sm text-foreground">
          Add this <strong>TXT record</strong> at your DNS provider, then click
          “Check now.”
        </p>
        <Field label="Type" value="TXT" />
        <Field label="Host / Name" value={host} copyable />
        <Field label="Value" value={value} copyable />
        <p className="text-xs text-muted-foreground">
          Some DNS providers append your domain to the host automatically — if
          so, enter just <code className="font-mono">_renewalradar</code>.
        </p>
      </div>

      {message && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {message}
        </div>
      )}

      {observed && observed.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <div className="font-medium mb-1">TXT records we currently see:</div>
          <ul className="font-mono space-y-0.5">
            {observed.map((r, i) => (
              <li key={i} className="break-all">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={check}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 text-sm font-medium"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Checking…" : "Check now"}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3">
      <div className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <code className="font-mono text-sm bg-muted/40 rounded px-2 py-1 truncate flex-1">
          {value}
        </code>
        {copyable && (
          <button
            type="button"
            onClick={copy}
            className="shrink-0 text-xs text-teal-700 hover:text-teal-900 inline-flex items-center gap-1"
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
