"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  logRenewalDecisionAction,
  type DecisionType,
} from "@/app/(app)/notice-deadlines/actions";
import { CancellationLetterDraft } from "./cancellation-letter-draft";
import { cn } from "@/lib/utils";

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
};

export function DecideNowForm(props: Props) {
  const router = useRouter();
  const [decision, setDecision] = useState<DecisionType | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [adjustedSeats, setAdjustedSeats] = useState(props.currentTotalSeats);
  const [adjustedPriceDollars, setAdjustedPriceDollars] = useState(
    (props.currentUnitPriceCents / 100).toFixed(2)
  );
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
              <div className="grid grid-cols-2 gap-3 mt-3 pl-7">
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

          <div className="pt-2">
            <Label htmlFor="decisionNote">Why this decision? (optional)</Label>
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
