"use client";

import { useEffect } from "react";
import { Button } from "@ui/components/primitives/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app:error-boundary]", error);
    // When Sentry is configured, this will surface there automatically
    // via the Sentry Next.js integration.
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md space-y-4">
        <div className="text-6xl" aria-hidden>
          ⚠️
        </div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          We've been notified and are looking into it. Try refreshing, or get
          in touch if it keeps happening.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground font-mono">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex justify-center gap-3 pt-2">
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
          <Button asChild>
            <a href="mailto:hello@renewalradar.com">Email support</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
