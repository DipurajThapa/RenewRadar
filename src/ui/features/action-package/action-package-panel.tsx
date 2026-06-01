import {
  CalendarPlus,
  CheckCircle2,
  HelpCircle,
  ListChecks,
  Sparkles,
} from "lucide-react";
import type { ActionPackage } from "@server/application/action-package";
import { PROVENANCE_LABEL_TEXT } from "@server/domain/provenance/labels";

/**
 * "Prepared for you" — the per-item action package. A read-time roll-up of the
 * brief recommendation, the reminder, the questions to ask, what's still
 * missing, and a one-item calendar download. Everything here is prepared for a
 * human to act on; nothing is sent or committed automatically.
 */
export function ActionPackagePanel({
  pkg,
  subscriptionId,
}: {
  pkg: ActionPackage;
  subscriptionId: string;
}) {
  void subscriptionId;
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/40 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-sky-600" />
        <h2 className="font-display font-semibold tracking-tight">
          Prepared for you
        </h2>
        {pkg.preparedBySystem && (
          <span className="text-[10px] uppercase tracking-wide rounded bg-white border px-1.5 py-0.5 text-muted-foreground">
            auto-prepared by the renewal agent
          </span>
        )}
      </div>

      {pkg.recommendedAction && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide rounded bg-sky-100 text-sky-900 px-2 py-0.5 font-semibold">
            {pkg.recommendedAction.replace(/_/g, " ")}
          </span>
          {pkg.recommendationProvenance && (
            <span className="text-xs text-muted-foreground">
              {PROVENANCE_LABEL_TEXT[pkg.recommendationProvenance]}
            </span>
          )}
          {pkg.headline && (
            <span className="text-sm text-foreground/90">· {pkg.headline}</span>
          )}
        </div>
      )}

      <p className="text-sm text-foreground/90">{pkg.reminderLine}</p>

      {pkg.vendorQuestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <HelpCircle className="h-3.5 w-3.5" />
            Questions to resolve
          </div>
          <ul className="list-disc list-inside text-sm text-foreground/90 space-y-0.5">
            {pkg.vendorQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {pkg.missingInfo.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" />
            Missing information
          </div>
          <ul className="space-y-1">
            {pkg.missingInfo.map((m) => (
              <li key={m.key} className="text-sm flex items-start gap-2">
                <span
                  className={
                    "mt-0.5 text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-semibold " +
                    (m.reason === "uncertain"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-700")
                  }
                >
                  {m.reason}
                </span>
                <span>
                  <span className="font-medium">{m.label}</span> — {m.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-sm">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2
            className={
              "h-4 w-4 " +
              (pkg.hasNoticeDraft ? "text-green-600" : "text-muted-foreground")
            }
          />
          {pkg.hasNoticeDraft
            ? "Internal notice drafted"
            : "No notice drafted yet"}
        </span>
        <a
          href={pkg.icsHref}
          className="inline-flex items-center gap-1.5 text-sky-700 hover:text-sky-900 underline-offset-2 hover:underline"
        >
          <CalendarPlus className="h-4 w-4" />
          Add deadline to calendar
        </a>
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-2">
        Advisor, never agent — everything above is prepared for you to review.
        Renewal Radar never contacts the vendor or commits a decision on its own.
      </p>
    </section>
  );
}
