"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FreeForeverNudge() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex items-start justify-between gap-4">
      <div className="flex-1 text-sm text-blue-900">
        <p className="font-medium">
          You're on Free Forever — tracking 5 of 5 subscriptions.
        </p>
        <p className="mt-1 text-blue-800">
          Hit a 6th to unlock unlimited tracking and the full Renewal Prep
          Pack. 14-day Starter trial, no credit card.
        </p>
        <Button asChild className="mt-3" size="sm">
          <Link href="/settings/billing">Start Starter trial →</Link>
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-blue-700 hover:text-blue-900"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
