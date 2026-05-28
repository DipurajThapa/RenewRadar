"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CoachStep = {
  title: string;
  body: string;
  action?: { href: string; label: string };
};

/**
 * Floating coach-mark sequence for first-time users.
 * Persists dismissal in localStorage so we don't re-show.
 *
 * Usage:
 *   <CoachMarkSequence storageKey="dashboard-tour-v1" steps={[...]} />
 */
export function CoachMarkSequence({
  storageKey,
  steps,
}: {
  storageKey: string;
  steps: CoachStep[];
}) {
  const [stepIdx, setStepIdx] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(storageKey);
    if (!dismissed) {
      setStepIdx(0);
    }
  }, [storageKey]);

  if (!mounted || stepIdx === null) return null;
  const step = steps[stepIdx];
  if (!step) return null;

  function next() {
    if (stepIdx === null) return;
    if (stepIdx + 1 < steps.length) {
      setStepIdx(stepIdx + 1);
    } else {
      dismiss();
    }
  }

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, "1");
    }
    setStepIdx(null);
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] bg-gray-900 text-white rounded-lg shadow-2xl p-5 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-400">
          Step {stepIdx + 1} of {steps.length}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss tour"
          className="text-gray-400 hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <h3 className="font-semibold mb-1">{step.title}</h3>
      <p className="text-sm text-gray-300 mb-4">{step.body}</p>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-gray-400 hover:text-white underline"
        >
          Skip tour
        </button>
        <div className="flex gap-2">
          {step.action && (
            <Button asChild variant="secondary" size="sm">
              <Link href={step.action.href}>{step.action.label}</Link>
            </Button>
          )}
          <Button size="sm" onClick={next}>
            {stepIdx + 1 === steps.length ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
