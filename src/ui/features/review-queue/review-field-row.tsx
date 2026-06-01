"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Edit3,
  ExternalLink,
  FileText,
  Quote,
  X,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { Input } from "@ui/components/primitives/input";
import { Badge } from "@ui/components/primitives/badge";
import { useToast } from "@ui/hooks/use-toast";
import { formatCurrency } from "@shared/utils";
import { reviewFieldAction } from "@app/(app)/review-queue/actions";
import type { PendingReviewField } from "@server/infrastructure/db/repositories/ai-extractions";
import {
  fieldProvenance,
  PROVENANCE_LABEL_TEXT,
  type ProvenanceLabel,
} from "@server/domain/provenance/labels";

const FIELD_LABEL: Record<string, string> = {
  renewal_date: "Renewal date",
  notice_period_days: "Notice period",
  auto_renewal: "Auto-renew",
  contract_value_cents: "Annualized value",
  price_increase_clause: "Price increase clause",
  cancellation_method: "Cancellation method",
  // Phase-1 obligation-generic keys.
  expiry_date: "Expiry date",
  issuer: "Issuer",
  reference_number: "Reference number",
};

/** UI tone per derived provenance band (the band logic itself lives in the
 *  domain helper — this map is the only UI concern). */
const PROVENANCE_BADGE_CLASS: Record<ProvenanceLabel, string> = {
  verified: "bg-green-50 text-green-900 border-green-200",
  inferred: "bg-amber-50 text-amber-900 border-amber-200",
  uncertain: "bg-red-50 text-red-900 border-red-200",
};

/**
 * One pending field. Shows: title, AI value, evidence quote with page
 * number, current subscription value (for diff), and accept/edit/reject
 * controls. Edit reveals an inline input for the field's typed value.
 */
export function ReviewFieldRow({ field }: { field: PendingReviewField }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(extractScalar(field.parsedValueJson, field.fieldKey));
  const router = useRouter();
  const { toast } = useToast();

  function handleDecision(
    decision: "accepted" | "edited" | "rejected",
    editedValueJson: Record<string, unknown> | null = null
  ) {
    startTransition(async () => {
      const r = await reviewFieldAction(field.id, decision, editedValueJson);
      if (r.ok) {
        toast({
          title:
            decision === "accepted"
              ? "Field accepted + applied"
              : decision === "edited"
                ? "Field edited + applied"
                : "Field rejected",
          description:
            decision === "rejected"
              ? "No subscription was changed."
              : "Subscription updated. See audit log for details.",
        });
        router.refresh();
      } else {
        toast({ title: "Couldn't process", description: r.error });
      }
    });
  }

  function handleAccept() {
    handleDecision("accepted");
  }
  function handleReject() {
    handleDecision("rejected");
  }
  function handleSaveEdit() {
    const edited = buildEditedJson(field.fieldKey, editValue);
    if (!edited) {
      toast({ title: "Invalid value", description: "Couldn't parse your edit." });
      return;
    }
    handleDecision("edited", edited);
  }

  const aiDisplay = displayValue(field.parsedValueJson, field.fieldKey);
  const currentDisplay = displayValue(
    field.subscriptionCurrentValueJson,
    field.fieldKey
  );
  const sameAsCurrent = currentDisplay && currentDisplay === aiDisplay;
  // Derived trust band — single source of truth shared with the action package.
  const provenance = fieldProvenance(
    field.confidence,
    field.reviewStatus,
    !!field.evidenceQuote
  );

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="font-semibold">
            {FIELD_LABEL[field.fieldKey] ?? field.fieldKey}
          </div>
          <Badge
            variant="outline"
            className={PROVENANCE_BADGE_CLASS[provenance]}
          >
            {PROVENANCE_LABEL_TEXT[provenance]} · {field.confidence}%
          </Badge>
          {sameAsCurrent && (
            <Badge variant="outline" className="bg-gray-50 text-gray-600">
              Matches current value
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              AI extracted
            </div>
            {editing ? (
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="New value"
                className="font-medium"
              />
            ) : (
              <div className="text-base font-medium tabular-nums">
                {aiDisplay ?? "—"}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Current on subscription
            </div>
            <div className="text-base text-muted-foreground tabular-nums">
              {currentDisplay ?? "—"}
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-amber-50/50 border-amber-200 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-amber-900">
            <Quote className="h-3 w-3" />
            Evidence
            <span className="ml-auto flex items-center gap-2">
              {field.evidencePageNumber !== null && (
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Page {field.evidencePageNumber}
                </span>
              )}
              {/* Verify-quote affordance (P6.13). Opens the document in a
                  new tab; most browsers honour the #page=N URL fragment to
                  scroll directly to the quoted page. */}
              <a
                href={
                  field.evidencePageNumber !== null
                    ? `/api/documents/${field.documentId}/inline#page=${field.evidencePageNumber}`
                    : `/api/documents/${field.documentId}/inline`
                }
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-amber-900 hover:text-amber-700 underline-offset-2 hover:underline"
              >
                Open contract
                <ExternalLink className="h-3 w-3" />
              </a>
            </span>
          </div>
          <p className="text-sm text-amber-950 italic mt-1 leading-relaxed">
            &ldquo;{field.evidenceQuote}&rdquo;
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setEditValue(extractScalar(field.parsedValueJson, field.fieldKey));
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={pending}>
                <ArrowRight className="mr-1 h-4 w-4" />
                Save + apply
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReject}
                disabled={pending}
              >
                <X className="mr-1 h-4 w-4" />
                Reject
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                disabled={pending}
              >
                <Edit3 className="mr-1 h-4 w-4" />
                Edit
              </Button>
              <Button size="sm" onClick={handleAccept} disabled={pending}>
                <Check className="mr-1 h-4 w-4" />
                Accept + apply
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── display helpers ────────────────────────────────────────────────────────

function displayValue(
  value: unknown,
  fieldKey: string
): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  switch (fieldKey) {
    case "renewal_date":
    case "expiry_date":
      return typeof v.date === "string" ? v.date : null;
    case "notice_period_days":
      return typeof v.days === "number" ? `${v.days} days` : null;
    case "auto_renewal":
      return typeof v.yes === "boolean" ? (v.yes ? "Yes" : "No") : null;
    case "contract_value_cents":
      return typeof v.cents === "number"
        ? `${formatCurrency(v.cents)}/yr`
        : null;
    case "price_increase_clause":
      return typeof v.clause === "string" ? v.clause : null;
    case "cancellation_method":
      return typeof v.method === "string" ? humanizeMethod(v.method) : null;
    case "issuer":
      return typeof v.issuer === "string"
        ? v.issuer
        : typeof v.value === "string"
          ? v.value
          : null;
    case "reference_number":
      return typeof v.reference === "string"
        ? v.reference
        : typeof v.value === "string"
          ? v.value
          : null;
    default:
      return null;
  }
}

function humanizeMethod(m: string): string {
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── edit helpers ───────────────────────────────────────────────────────────

function extractScalar(value: unknown, fieldKey: string): string {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  switch (fieldKey) {
    case "renewal_date":
    case "expiry_date":
      return typeof v.date === "string" ? v.date : "";
    case "notice_period_days":
      return typeof v.days === "number" ? String(v.days) : "";
    case "auto_renewal":
      return typeof v.yes === "boolean" ? (v.yes ? "yes" : "no") : "";
    case "contract_value_cents":
      return typeof v.cents === "number" ? (v.cents / 100).toFixed(2) : "";
    case "price_increase_clause":
      return typeof v.clause === "string" ? v.clause : "";
    case "cancellation_method":
      return typeof v.method === "string" ? v.method : "";
    case "issuer":
      return typeof v.issuer === "string"
        ? v.issuer
        : typeof v.value === "string"
          ? v.value
          : "";
    case "reference_number":
      return typeof v.reference === "string"
        ? v.reference
        : typeof v.value === "string"
          ? v.value
          : "";
    default:
      return "";
  }
}

function buildEditedJson(
  fieldKey: string,
  raw: string
): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  switch (fieldKey) {
    case "renewal_date":
    case "expiry_date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
      return { date: trimmed };
    case "notice_period_days": {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || n > 365) return null;
      return { days: Math.round(n) };
    }
    case "auto_renewal":
      if (/^(yes|true|y)$/i.test(trimmed)) return { yes: true };
      if (/^(no|false|n)$/i.test(trimmed)) return { yes: false };
      return null;
    case "contract_value_cents": {
      const dollars = Number(trimmed.replace(/[$,]/g, ""));
      if (!Number.isFinite(dollars) || dollars < 0) return null;
      return { cents: Math.round(dollars * 100), currency: "USD" };
    }
    case "price_increase_clause":
      return { clause: trimmed };
    case "cancellation_method": {
      const valid = ["email", "written_notice", "portal", "account_manager", "unknown"];
      if (!valid.includes(trimmed)) return null;
      return { method: trimmed };
    }
    case "issuer":
      return { issuer: trimmed };
    case "reference_number":
      return { reference: trimmed };
    default:
      return null;
  }
}
