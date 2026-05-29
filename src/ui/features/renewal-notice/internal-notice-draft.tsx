"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Copy, Check, Download } from "lucide-react";
import { useToast } from "@ui/hooks/use-toast";
import {
  draftInternalNoticeAction,
  saveInternalNoticeAction,
} from "@app/(app)/subscriptions/[id]/actions";

type Draft = {
  id: string;
  subject: string;
  bodyText: string;
  status: string;
};

/**
 * A3 — safe-agent INTERNAL renewal-notice draft. Renewal Radar composes an
 * internal memo from the Renewal Intelligence Brief; the human edits + sends it
 * INTERNALLY. It is never addressed to or sent to the vendor.
 */
export function InternalNoticeDraft({
  subscriptionId,
  draft,
  canGenerate,
  hasBrief,
}: {
  subscriptionId: string;
  draft: Draft | null;
  canGenerate: boolean;
  hasBrief: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [bodyText, setBodyText] = useState(draft?.bodyText ?? "");
  const [copied, setCopied] = useState(false);

  function generate() {
    startTransition(async () => {
      const r = await draftInternalNoticeAction(subscriptionId);
      if (!r.ok) {
        toast({ title: "Couldn't draft notice", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: "Internal notice drafted" });
    });
  }

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const r = await saveInternalNoticeAction({
        subscriptionId,
        draftId: draft.id,
        subject,
        bodyText,
      });
      if (!r.ok) {
        toast({ title: "Couldn't save", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: "Notice saved" });
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${bodyText}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: "Select the text manually." });
    }
  }

  function download() {
    const blob = new Blob([`Subject: ${subject}\n\n${bodyText}`], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `internal-renewal-notice-${subscriptionId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-amber-700" />
          <h2 className="font-display font-semibold tracking-tight">
            Internal renewal notice
          </h2>
        </div>
        {!draft &&
          canGenerate &&
          (hasBrief ? (
            <button
              type="button"
              onClick={generate}
              disabled={pending}
              className="rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-sm font-medium"
            >
              {pending ? "Drafting…" : "Draft internal notice"}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Generate a brief first
            </span>
          ))}
      </div>

      {!draft ? (
        <p className="text-sm text-muted-foreground">
          Turn the brief into a ready-to-send INTERNAL memo for your procurement
          owner — recommendation, notice deadline, and the supporting points.
          You review and send it internally; Renewal Radar never contacts the
          vendor.
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Subject
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-md border bg-white px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Body (editable)
            </label>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={16}
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-xs font-sans leading-relaxed"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-sm font-medium"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={copy}
              className="rounded-md border bg-white px-3 py-1.5 text-sm inline-flex items-center gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={download}
              className="rounded-md border bg-white px-3 py-1.5 text-sm inline-flex items-center gap-1.5"
            >
              <Download className="h-4 w-4" /> Download .txt
            </button>
            {draft.status === "edited" && (
              <span className="self-center text-xs text-muted-foreground">
                Edited
              </span>
            )}
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground border-t pt-2">
        Internal memo only — never addressed to the vendor. Not legal advice;
        review against your contract&apos;s notice clause. A human sends every
        external communication.
      </p>
    </section>
  );
}
