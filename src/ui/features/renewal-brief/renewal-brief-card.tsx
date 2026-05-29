"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ChevronDown, BadgeCheck } from "lucide-react";
import { useState } from "react";
import { useToast } from "@ui/hooks/use-toast";
import { generateBriefAction } from "@app/(app)/subscriptions/[id]/actions";
import type {
  BriefClaim,
  RenewalIntelligenceBrief,
} from "@server/infrastructure/ai/reasoning/types";

const CLAIM_LABEL: Record<string, string> = {
  price_trajectory: "Price trajectory",
  benchmark_position: "Benchmark",
  renewal_risk: "Renewal risk",
  leverage: "Negotiation leverage",
  batna: "Your walk-away (BATNA)",
  recommended_action: "Recommendation",
};

const ACTION_TONE: Record<string, string> = {
  renewed: "bg-green-100 text-green-800",
  renewed_with_adjustments: "bg-amber-100 text-amber-800",
  downgraded: "bg-amber-100 text-amber-800",
  cancelled: "bg-red-100 text-red-700",
  deferred: "bg-red-100 text-red-700",
};

export function RenewalBriefCard({
  subscriptionId,
  brief,
  generatedAt,
  canGenerate = true,
}: {
  subscriptionId: string;
  brief: RenewalIntelligenceBrief | null;
  generatedAt: string | null;
  /** False when the plan tier doesn't include the renewal brief — the button
   *  is hidden and an upgrade nudge is shown instead (mirrors the server gate). */
  canGenerate?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function generate() {
    startTransition(async () => {
      const r = await generateBriefAction(subscriptionId);
      if (!r.ok) {
        toast({ title: "Couldn't generate brief", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: "Renewal brief generated" });
    });
  }

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-600" />
          <h2 className="font-display font-semibold tracking-tight">
            Renewal Intelligence Brief
          </h2>
          {brief && (
            <span className="text-[10px] uppercase tracking-wide rounded bg-white border px-1.5 py-0.5 text-muted-foreground inline-flex items-center gap-1">
              <BadgeCheck className="h-3 w-3" />
              {brief.meta.engine === "llm" ? "Claude" : "Deterministic"}
            </span>
          )}
        </div>
        {canGenerate ? (
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="rounded-md bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-sm font-medium"
          >
            {pending ? "Analyzing…" : brief ? "Regenerate" : "Generate brief"}
          </button>
        ) : (
          <a
            href="/settings/billing"
            className="rounded-md bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-sm font-medium"
          >
            Upgrade
          </a>
        )}
      </div>

      {!brief ? (
        canGenerate ? (
          <p className="text-sm text-muted-foreground">
            Reason over this subscription&apos;s own price history, the
            cross-account benchmark, the notice-window urgency, and your past
            decisions — into one evidence-backed recommendation. Every claim
            shows its receipts.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            The Renewal Intelligence Brief turns this subscription&apos;s price
            history, the cross-account benchmark, and notice-window urgency into
            one evidence-backed recommendation. Upgrade to generate it.
          </p>
        )
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={
                "text-xs uppercase tracking-wide rounded px-2 py-0.5 font-semibold " +
                (ACTION_TONE[brief.recommendedAction] ?? "bg-secondary")
              }
            >
              {brief.recommendedAction.replace(/_/g, " ")}
            </span>
            <span className="text-xs text-muted-foreground">
              {brief.meta.confidencePct}% confidence
              {generatedAt ? ` · ${generatedAt}` : ""}
            </span>
          </div>
          <p className="text-sm font-medium">{brief.headline}</p>

          {brief.predictedNextAnnualCents && (
            <div className="rounded-md border bg-white px-3 py-2 text-sm">
              <span className="text-muted-foreground">Projected next renewal: </span>
              <span className="font-medium tabular-nums">
                ${Math.round(brief.predictedNextAnnualCents.point / 100).toLocaleString()}
                /yr
              </span>
              <span className="text-muted-foreground">
                {" "}(range $
                {Math.round(brief.predictedNextAnnualCents.low / 100).toLocaleString()}–$
                {Math.round(brief.predictedNextAnnualCents.high / 100).toLocaleString()})
              </span>
            </div>
          )}

          <div className="space-y-2">
            {brief.claims.map((c, i) => (
              <ClaimRow key={`${c.key}-${i}`} claim={c} />
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground border-t pt-2">
            Advisor, never agent — Renewal Radar can draft your internal notice,
            but a human always contacts the vendor. Provenance is labeled per
            claim; nothing here is fabricated without evidence.
          </p>
        </>
      )}
    </section>
  );
}

function ClaimRow({ claim }: { claim: BriefClaim }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-start justify-between gap-2"
      >
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            {CLAIM_LABEL[claim.key] ?? claim.key}
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
