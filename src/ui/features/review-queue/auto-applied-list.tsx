"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Undo2 } from "lucide-react";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { useToast } from "@ui/hooks/use-toast";
import { revertAutoAppliedFieldAction } from "@app/(app)/review-queue/actions";

export type AutoAppliedItem = {
  fieldId: string;
  fieldKey: string;
  label: string; // human-readable value, e.g. "60 days"
  vendorProduct: string | null;
  confidencePct: number;
};

const FIELD_LABEL: Record<string, string> = {
  renewal_date: "Renewal date",
  expiry_date: "Expiry date",
  notice_period_days: "Notice period",
  auto_renewal: "Auto-renew",
};

/**
 * The AI auto-applied these high-confidence fields without review (conservative
 * policy). Each is one-click reversible — undo restores the previous value and
 * marks the field as a human correction (feeding the AI feedback loop).
 *
 * Only rendered when auto-apply is enabled and has written at least one field.
 */
export function AutoAppliedList({ items }: { items: AutoAppliedItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) return null;

  function undo(fieldId: string) {
    startTransition(async () => {
      const res = await revertAutoAppliedFieldAction(fieldId);
      if (res.ok) {
        toast({ title: "Reverted", description: "The previous value was restored." });
        router.refresh();
      } else {
        toast({
          title: "Couldn't revert",
          description: res.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          Auto-applied by AI
          <span className="text-xs font-normal text-muted-foreground">
            high-confidence, safe fields — applied without review, fully reversible
          </span>
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((item) => (
            <li
              key={item.fieldId}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium text-foreground">
                  {FIELD_LABEL[item.fieldKey] ?? item.fieldKey}
                </span>{" "}
                <span className="text-foreground">{item.label}</span>
                {item.vendorProduct ? (
                  <span className="text-muted-foreground"> · {item.vendorProduct}</span>
                ) : null}
                <span className="ml-2 text-xs text-muted-foreground">
                  {item.confidencePct}% confidence
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => undo(item.fieldId)}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" />
                Undo
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
