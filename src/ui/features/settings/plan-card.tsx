"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ui/components/primitives/card";
import { cn } from "@shared/utils";
import { createCheckoutSession } from "@server/infrastructure/billing/checkout";
import {
  TIER_DEFINITIONS,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";

/**
 * In-product upgrade-flow plan card. All pricing data derives from
 * TIER_DEFINITIONS — caller only passes the tier and whether it's current.
 */
type Props = {
  tier: Exclude<PlanTier, "free_forever" | "enterprise">;
  current: boolean;
};

export function PlanCard({ tier, current }: Props) {
  const def = TIER_DEFINITIONS[tier];
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleUpgrade() {
    setError(null);
    startTransition(async () => {
      const result = await createCheckoutSession({ tier });
      if (result.ok) {
        window.location.href = result.url;
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card className={cn(current && "border-foreground")}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{def.label}</span>
          {current && (
            <span className="text-xs font-normal text-muted-foreground">
              Current plan
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-3xl font-bold tabular-nums">
            {def.priceDisplay}
            <span className="text-base text-muted-foreground font-normal">
              {def.priceCadence}
            </span>
          </div>
          {def.subPriceDisplay && (
            <div className="text-xs text-muted-foreground mt-1">
              {def.subPriceDisplay}
            </div>
          )}
        </div>

        <ul className="space-y-1.5 text-sm">
          {def.features.slice(0, 5).map((feature, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">
            {error}
          </div>
        )}

        <Button
          type="button"
          className="w-full"
          onClick={handleUpgrade}
          disabled={pending || current}
        >
          {pending ? "Loading..." : current ? "Current plan" : def.ctaLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
