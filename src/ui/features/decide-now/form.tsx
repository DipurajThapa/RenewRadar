"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { Input } from "@ui/components/primitives/input";
import { Label } from "@ui/components/primitives/label";
import {
  logRenewalDecisionAction,
  type DecisionType,
} from "@app/(app)/notice-deadlines/actions";
import { CancellationLetterDraft } from "./cancellation-letter-draft";
import { cn } from "@shared/utils";

/**
 * Rationale codes the form surfaces. Subset chosen from
 * @server/domain/vendor-memory/event-labels.ts — every code here also
 * appears there and is accepted by the `rationaleCodeEnum` in
 * notice-deadlines/actions.ts. Keep this list short for usability; we
 * surface the most-cited codes only.
 */
const RATIONALE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "cost_reduction", label: "Cost reduction" },
  { code: "low_usage", label: "Low usage" },
  { code: "no_longer_needed", label: "No longer needed" },
  { code: "found_alternative", label: "Found alternative" },
  { code: "consolidation", label: "Tool consolidation" },
  { code: "missing_features", label: "Missing features" },
  { code: "poor_performance", label: "Poor performance" },
  { code: "support_issues", label: "Support issues" },
];

/**
 * Negotiation levers. Mirrors `NEGOTIATION_LEVER_LABEL` in
 * @server/domain/vendor-memory/event-labels.ts. "none" is the default.
 */
const LEVER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "No lever used" },
  { value: "multi_year_commit", label: "Multi-year commitment" },
  { value: "competing_quote", label: "Competing quote" },
  { value: "volume_increase", label: "Volume increase" },
  { value: "payment_terms", label: "Payment terms" },
  { value: "consolidated_with_other_products", label: "Bundled with other products" },
  { value: "executive_escalation", label: "Executive escalation" },
  { value: "threatened_cancellation", label: "Threatened cancellation" },
  { value: "other", label: "Other" },
];

type Props = {
  renewalEventId: string;
  subscriptionId: string;
  currentTotalSeats: number;
  currentUnitPriceCents: number;
  vendorName: string;
  productName: string;
  termEndDate: string;
  vendorCancellationEmail: string | null;
  vendorCancellationUrl: string | null;
  defaultCustomerName?: string;
  defaultCompanyName?: string;
  /**
   * Optional AI-derived suggestion. When present, a "Use this recommendation"
   * button at the top of the form prefills decision + suggested lever in one
   * click. The user still has to confirm to submit — no auto-action.
   */
  suggestion?: {
    decision: DecisionType;
    /** Display string the user sees on the button (already humanized). */
    decisionLabel: string;
    /** Lever to prefill when applicable, raw enum value (e.g. "multi_year_commit"). */
    suggestedLever?: string | null;
    /** Rationale codes to prefill as chips. */
    rationaleCodes?: string[];
  };
};

export function DecideNowForm(props: Props) {
  const router = useRouter();
  const [decision, setDecision] = useState<DecisionType | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [adjustedSeats, setAdjustedSeats] = useState(props.currentTotalSeats);
  const [adjustedPriceDollars, setAdjustedPriceDollars] = useState(
    (props.currentUnitPriceCents / 100).toFixed(2)
  );
  const [rationaleCodes, setRationaleCodes] = useState<string[]>([]);
  const [negotiationLever, setNegotiationLever] = useState<string>("none");
  const [alternativesConsidered, setAlternativesConsidered] = useState("");
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggleRationale(code: string) {
    setRationaleCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  function applySuggestion() {
    const s = props.suggestion;
    if (!s) return;
    setDecision(s.decision);
    if (s.rationaleCodes && s.rationaleCodes.length > 0) {
      setRationaleCodes(s.rationaleCodes);
    }
    if (s.suggestedLever) {
      setNegotiationLever(s.suggestedLever);
    }
  }

  /**
   * Whether to surface the negotiation lever picker. Only meaningful for
   * decisions where the user actually negotiated — renew-with-adjustments
   * and downgrade. Renew-as-is and cancel don't ask the question.
   */
  const showLever =
    decision === "renewed_with_adjustments" || decision === "downgraded";

  /**
   * Alternatives-considered is most meaningful for downgrade and cancel —
   * the user is moving off this contract, so "where did the work go?" is
   * the high-signal question. Surface for renew-with-adjustments too in
   * case they swapped to a cheaper plan with a different product.
   */
  const showAlternatives = decision !== null && decision !== "renewed";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision) {
      setErrorMessage("Please choose one of the decision options.");
      return;
    }
    setErrorMessage(null);

    const formData = new FormData();
    formData.set("renewalEventId", props.renewalEventId);
    formData.set("decision", decision);
    if (decisionNote.trim()) formData.set("decisionNote", decisionNote);
    if (decision === "renewed_with_adjustments") {
      formData.set("adjustedSeatCount", String(adjustedSeats));
      formData.set("adjustedUnitPriceDollars", adjustedPriceDollars);
    }
    // Rationale codes go on multiple form entries with the same name — the
    // server-side action uses FormData.getAll("rationaleCodes") to collect
    // them.
    for (const code of rationaleCodes) {
      formData.append("rationaleCodes", code);
    }
    if (showLever && negotiationLever && negotiationLever !== "none") {
      formData.set("negotiationLever", negotiationLever);
    }
    if (showAlternatives && alternativesConsidered.trim()) {
      formData.set("alternativesConsidered", alternativesConsidered.trim());
    }

    startTransition(async () => {
      const result = await logRenewalDecisionAction(formData);
      if (result.ok) {
        if (decision !== "cancelled") {
          // For non-cancel decisions, route back to the calendar.
          // For cancel, stay on the page so the cancellation letter is visible.
          router.push("/notice-deadlines");
        }
        router.refresh();
      } else {
        setErrorMessage(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Your decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.suggestion && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary-soft/30 px-3 py-2.5">
              <div className="text-sm">
                <span className="font-medium">AI suggests:</span>{" "}
                <span className="capitalize">
                  {props.suggestion.decisionLabel}
                </span>
                {props.suggestion.suggestedLever &&
                  props.suggestion.suggestedLever !== "none" && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {props.suggestion.suggestedLever.replace(/_/g, " ")}
                    </span>
                  )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={applySuggestion}
              >
                Use this recommendation
              </Button>
            </div>
          )}
          <DecisionOption
            value="renewed"
            current={decision}
            onChange={setDecision}
            label="Renew as-is"
            description="Keep paying the current rate. No changes to seats or price."
          />

          <DecisionOption
            value="renewed_with_adjustments"
            current={decision}
            onChange={setDecision}
            label="Renew with adjustments"
            description="You've negotiated a new seat count or price."
          >
            {decision === "renewed_with_adjustments" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 sm:pl-7">
                <div>
                  <Label htmlFor="adjustedSeats" className="text-xs">
                    New seat count
                  </Label>
                  <Input
                    id="adjustedSeats"
                    type="number"
                    value={adjustedSeats}
                    onChange={(e) => setAdjustedSeats(Number(e.target.value))}
                    min={0}
                    step={1}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="adjustedPriceDollars" className="text-xs">
                    New unit price (USD)
                  </Label>
                  <Input
                    id="adjustedPriceDollars"
                    type="number"
                    value={adjustedPriceDollars}
                    onChange={(e) => setAdjustedPriceDollars(e.target.value)}
                    step="0.01"
                    min={0}
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </DecisionOption>

          <DecisionOption
            value="downgraded"
            current={decision}
            onChange={setDecision}
            label="Downgrade"
            description="Switch to a lower-tier plan with this vendor."
          />

          <DecisionOption
            value="cancelled"
            current={decision}
            onChange={setDecision}
            label="Cancel"
            description="Don't renew. You'll send the cancellation letter from your own email."
          />

          {decision !== null && (
            <div className="pt-3 space-y-4 border-t">
              <div>
                <Label className="text-sm">
                  Why? <span className="text-muted-foreground font-normal">(pick any that apply)</span>
                </Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {RATIONALE_OPTIONS.map((opt) => {
                    const active = rationaleCodes.includes(opt.code);
                    return (
                      <button
                        key={opt.code}
                        type="button"
                        onClick={() => toggleRationale(opt.code)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs transition-colors",
                          active
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-background hover:bg-muted"
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Codes go into vendor memory and the savings narrative — pick
                  what the next person reviewing this would want to know.
                </p>
              </div>

              {showLever && (
                <div>
                  <Label htmlFor="negotiationLever" className="text-sm">
                    Negotiation lever{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <select
                    id="negotiationLever"
                    value={negotiationLever}
                    onChange={(e) => setNegotiationLever(e.target.value)}
                    className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {LEVER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    What got the vendor to the table. Reused next renewal.
                  </p>
                </div>
              )}

              {showAlternatives && (
                <div>
                  <Label htmlFor="alternativesConsidered" className="text-sm">
                    Alternatives considered{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <textarea
                    id="alternativesConsidered"
                    value={alternativesConsidered}
                    onChange={(e) => setAlternativesConsidered(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="e.g. Considered Notion, Mem, Roam. Picked Notion for SSO support."
                  />
                </div>
              )}
            </div>
          )}

          <div className="pt-2">
            <Label htmlFor="decisionNote">Free-form note (optional)</Label>
            <textarea
              id="decisionNote"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="e.g. Talked to manager 5/26 — agreed to reduce to 35 seats."
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!decision || pending}>
          {pending ? "Logging..." : "Log decision"}
        </Button>
      </div>

      {decision === "cancelled" && (
        <CancellationLetterDraft
          vendorName={props.vendorName}
          productName={props.productName}
          termEndDate={props.termEndDate}
          vendorCancellationEmail={props.vendorCancellationEmail}
          vendorCancellationUrl={props.vendorCancellationUrl}
          defaultCustomerName={props.defaultCustomerName}
          defaultCompanyName={props.defaultCompanyName}
        />
      )}
    </form>
  );
}

function DecisionOption({
  value,
  current,
  onChange,
  label,
  description,
  children,
}: {
  value: DecisionType;
  current: DecisionType | null;
  onChange: (v: DecisionType) => void;
  label: string;
  description: string;
  children?: React.ReactNode;
}) {
  const selected = current === value;
  return (
    <label
      className={cn(
        "block border rounded-md p-3 cursor-pointer transition-colors",
        selected
          ? "border-gray-900 bg-muted/40"
          : "border-gray-200 hover:bg-muted/20"
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="decision"
          value={value}
          checked={selected}
          onChange={() => onChange(value)}
          className="mt-1 h-4 w-4"
        />
        <div className="flex-1">
          <div className="font-medium text-sm">{label}</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {description}
          </div>
        </div>
      </div>
      {children}
    </label>
  );
}
