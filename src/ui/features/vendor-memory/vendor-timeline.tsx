import {
  FileText,
  Edit3,
  XCircle,
  CheckCircle,
  Quote,
  TrendingUp,
  TrendingDown,
  UserCheck,
  AlertTriangle,
  StickyNote,
  ClipboardCheck,
  ScrollText,
  Sparkles,
  BadgeCheck,
} from "lucide-react";
import type { VendorEventKind } from "@server/infrastructure/db/schema";
import { VENDOR_EVENT_LABEL } from "@server/domain/vendor-memory/event-labels";
import { formatDate, formatCurrency } from "@shared/utils";
import type { VendorEventRow } from "@server/infrastructure/db/repositories/vendor-memory";

const ICON_BY_KIND: Record<VendorEventKind, React.ComponentType<{ className?: string }>> = {
  subscription_created: ScrollText,
  subscription_updated: Edit3,
  subscription_cancelled: XCircle,
  contract_uploaded: FileText,
  contract_field_applied: Quote,
  renewal_decision_logged: ClipboardCheck,
  renewal_decision_approved: CheckCircle,
  renewal_decision_rejected: XCircle,
  savings_recorded: TrendingDown,
  price_changed: TrendingUp,
  seat_count_changed: Edit3,
  owner_changed: UserCheck,
  compliance_doc_received: ScrollText,
  compliance_doc_expired: AlertTriangle,
  notice_deadline_missed: AlertTriangle,
  user_note_added: StickyNote,
  renewal_brief_generated: Sparkles,
  savings_realized: BadgeCheck,
};

export function VendorTimeline({ events }: { events: VendorEventRow[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing recorded yet. Events will appear here as you upload contracts,
        log decisions, and record compliance documents.
      </p>
    );
  }

  return (
    <ol className="space-y-4 relative">
      <div
        className="absolute left-[15px] top-3 bottom-3 w-px bg-border"
        aria-hidden
      />
      {events.map((event) => {
        const Icon = ICON_BY_KIND[event.kind as VendorEventKind] ?? StickyNote;
        return (
          <li key={event.id} className="relative pl-10">
            <div className="absolute left-0 top-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatDate(event.occurredAt)}
              {event.actorName && (
                <>
                  {" · "}
                  by <strong>{event.actorName}</strong>
                </>
              )}
              {!event.actorName && !event.actorEmail && (
                <> · by system</>
              )}
            </div>
            <div className="font-medium text-sm mt-0.5">
              {VENDOR_EVENT_LABEL[event.kind as VendorEventKind] ?? event.kind}
            </div>
            <EventDetail kind={event.kind as VendorEventKind} payload={event.payload} />
          </li>
        );
      })}
    </ol>
  );
}

function EventDetail({ kind, payload }: { kind: VendorEventKind; payload: unknown }) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  switch (kind) {
    case "subscription_created":
      return (
        <p className="text-xs text-muted-foreground mt-1">
          {String(p.productName ?? "")} ·{" "}
          {formatCurrency((p.totalCostPerPeriodCents as number) ?? 0)}{" "}
          {String(p.billingCycle ?? "")} · {String(p.totalSeats ?? 0)} seats
        </p>
      );
    case "subscription_updated": {
      const changes = (p.changes as Array<{ field: string }>) ?? [];
      if (changes.length === 0) return null;
      return (
        <p className="text-xs text-muted-foreground mt-1">
          Changed: {changes.map((c) => c.field).join(", ")}
        </p>
      );
    }
    case "subscription_cancelled":
      return (
        <p className="text-xs text-muted-foreground mt-1">
          {String(p.productName ?? "")} (term ended{" "}
          {String(p.termEndDate ?? "")})
        </p>
      );
    case "contract_uploaded":
      return (
        <p className="text-xs text-muted-foreground mt-1">
          {String(p.filename ?? "")}
          {p.pageCount ? ` · ${p.pageCount} pages` : ""}
        </p>
      );
    case "contract_field_applied":
      return (
        <div className="text-xs mt-1 space-y-1">
          <div className="text-muted-foreground">
            <code className="text-xs">{String(p.fieldKey ?? "")}</code> applied
            {p.evidencePageNumber ? ` (page ${p.evidencePageNumber})` : ""}
            {typeof p.confidencePct === "number"
              ? ` · ${p.confidencePct}% confidence`
              : ""}
          </div>
          {typeof p.evidenceQuote === "string" && p.evidenceQuote.length > 0 && (
            <blockquote className="border-l-2 border-amber-200 pl-2 italic text-amber-900">
              &ldquo;{p.evidenceQuote}&rdquo;
            </blockquote>
          )}
        </div>
      );
    case "renewal_decision_logged": {
      const rationales = (p.rationaleCodes as string[]) ?? [];
      const lever = String(p.negotiationLever ?? "");
      const outcome = p.negotiationOutcomeSummary
        ? String(p.negotiationOutcomeSummary)
        : null;
      const alternatives = p.alternativesConsidered
        ? String(p.alternativesConsidered)
        : null;
      return (
        <div className="text-xs mt-1 space-y-1">
          <div>
            Decision: <strong>{String(p.decision ?? "").replace(/_/g, " ")}</strong>
          </div>
          {rationales.length > 0 && (
            <div className="text-muted-foreground">
              Why: {rationales.join(", ")}
            </div>
          )}
          {lever && lever !== "none" && (
            <div className="text-muted-foreground">
              Lever: {lever.replace(/_/g, " ")}
            </div>
          )}
          {outcome && (
            <div className="text-muted-foreground">Outcome: {outcome}</div>
          )}
          {alternatives && (
            <div className="text-muted-foreground">
              Alternatives considered: {alternatives}
            </div>
          )}
          {typeof p.expectedAnnualSavingsUsdCents === "number" &&
            p.expectedAnnualSavingsUsdCents > 0 && (
              <div className="text-green-700">
                Expected savings:{" "}
                {formatCurrency(p.expectedAnnualSavingsUsdCents)}/yr
              </div>
            )}
        </div>
      );
    }
    case "savings_recorded":
      return (
        <p className="text-xs text-green-700 mt-1">
          Saved {formatCurrency((p.savedAnnualUsdCents as number) ?? 0)}/yr ·{" "}
          {String(p.kind ?? "")}
        </p>
      );
    case "price_changed":
      return (
        <p
          className={`text-xs mt-1 ${
            (p.deltaPct as number) > 0 ? "text-amber-700" : "text-green-700"
          }`}
        >
          {(p.deltaPct as number) > 0 ? "+" : ""}
          {((p.deltaPct as number) ?? 0).toFixed(2)}%:{" "}
          {formatCurrency((p.beforeTotalCostPerPeriodCents as number) ?? 0)} →{" "}
          {formatCurrency((p.afterTotalCostPerPeriodCents as number) ?? 0)}
        </p>
      );
    case "seat_count_changed":
      return (
        <p className="text-xs text-muted-foreground mt-1">
          {String(p.beforeSeats ?? 0)} → {String(p.afterSeats ?? 0)} seats (
          {(p.deltaSeats as number) > 0 ? "+" : ""}
          {String(p.deltaSeats ?? 0)})
        </p>
      );
    case "compliance_doc_received":
      return (
        <p className="text-xs text-muted-foreground mt-1">
          {String(p.artifactKind ?? "")}
          {p.expiresAt
            ? ` · expires ${String(p.expiresAt).split("T")[0]}`
            : ""}
        </p>
      );
    case "notice_deadline_missed":
      return (
        <p className="text-xs text-red-700 mt-1">
          {String(p.productName ?? "")} · auto-renewed{" "}
          {formatCurrency((p.annualValueCents as number) ?? 0)}/yr
        </p>
      );
    default:
      return null;
  }
}
