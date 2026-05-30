"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight, Send } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@ui/components/primitives/dropdown-menu";
import { ClaimRow } from "@ui/features/renewal-brief/claim-row";
import { useToast } from "@ui/hooks/use-toast";
import { askAssistantAction } from "@app/(app)/assistant/actions";
import type { GroundedAnswer } from "@server/infrastructure/ai/reasoning/types";

const SUGGESTIONS = [
  "What's my biggest risk?",
  "What renews next month?",
  "Show me our savings",
];

/**
 * Inline grounded "Ask" assistant — hosted in the TopNav (no full-page route).
 * Read-only: it answers ONLY from the account's own data, renders the evidence
 * via the shared ClaimRow, and deep-links into existing screens. Never acts.
 */
export function AskPanel() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || pending) return;
    startTransition(async () => {
      const r = await askAssistantAction(trimmed);
      if (!r.ok) {
        toast({ title: "Couldn't answer that", description: r.error });
        return;
      }
      setAnswer(r.answer);
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Ask Renewal Radar"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[400px] p-0">
        <div className="px-3 py-2 border-b flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          <span className="text-sm font-semibold">Ask Renewal Radar</span>
        </div>

        <div className="p-3 space-y-3">
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              // Stop the dropdown's typeahead from swallowing keystrokes.
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") submit(question);
              }}
              placeholder="e.g. what's my biggest risk?"
              autoFocus
              className="flex-1 rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => submit(question)}
              disabled={pending}
              aria-label="Ask"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          {!answer && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setQuestion(s);
                      submit(s);
                    }}
                    className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Answers come only from your own data — renewals, risk, spend,
                savings, and compliance.
              </p>
            </div>
          )}

          {answer && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{answer.summary}</p>
              {answer.answers.map((a, i) => (
                <ClaimRow key={i} claim={a} />
              ))}
              {answer.missingInfo.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {answer.missingInfo.join(" ")}
                </p>
              )}
              {answer.deepLinks.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {answer.deepLinks.map((d, i) => (
                    <Link
                      key={i}
                      href={d.href}
                      onClick={() => setOpen(false)}
                      className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 underline-offset-2 hover:underline"
                    >
                      {d.label}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground border-t pt-2">
            Advisor, never agent — answers are grounded in your data with their
            evidence shown. Renewal Radar never acts on its own.
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
