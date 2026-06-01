"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A collapsible evidence row — the shared display for both a brief `BriefClaim`
 * and an Ask-assistant `AnswerClaim`. Both carry the same structural shape
 * (statement + engine + confidence + evidence[]); the brief adds a `key` label.
 * Extracted from renewal-brief-card so the assistant reuses it verbatim.
 */
export const CLAIM_LABEL: Record<string, string> = {
  price_trajectory: "Price trajectory",
  benchmark_position: "Benchmark",
  renewal_risk: "Renewal risk",
  leverage: "Negotiation leverage",
  batna: "Your walk-away (BATNA)",
  recommended_action: "Recommendation",
};

export type ClaimLike = {
  key?: string;
  statement: string;
  engine: "deterministic" | "llm";
  confidencePct: number;
  evidence: ReadonlyArray<{
    source: string;
    detail: string;
    quote: string | null;
  }>;
};

export function ClaimRow({ claim }: { claim: ClaimLike }) {
  const [open, setOpen] = useState(false);
  const label = claim.key ? (CLAIM_LABEL[claim.key] ?? claim.key) : "Finding";
  return (
    <div className="rounded-md border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-start justify-between gap-2"
      >
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            {label}
            <span className="text-indigo-600">
              {claim.engine === "llm" ? "Claude" : "deterministic"}
            </span>
            <span>· {claim.confidencePct}%</span>
          </div>
          <div className="text-sm mt-0.5">{claim.statement}</div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-1.5 bg-muted/20">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Evidence
          </div>
          {claim.evidence.map((e, i) => (
            <div key={i} className="text-xs text-foreground/80">
              <span className="font-medium">{e.source.replace(/_/g, " ")}:</span>{" "}
              {e.detail}
              {e.quote && (
                <blockquote className="mt-1 border-l-2 pl-2 italic text-muted-foreground">
                  &ldquo;{e.quote}&rdquo;
                </blockquote>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
