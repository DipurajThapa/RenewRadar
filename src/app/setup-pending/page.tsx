"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SetupPendingPage() {
  const router = useRouter();

  useEffect(() => {
    // Poll: try dashboard again every 3 seconds; if the webhook landed,
    // the (app) layout will let us through; otherwise we re-render here.
    const interval = setInterval(() => {
      router.refresh();
      router.push("/dashboard");
    }, 3000);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-md space-y-3">
        <div className="text-3xl" aria-hidden>
          ⏳
        </div>
        <h1 className="text-xl font-semibold">Setting up your account...</h1>
        <p className="text-sm text-muted-foreground">
          Usually takes a few seconds. If it's been more than a minute,{" "}
          <a href="mailto:hello@renewalradar.com" className="underline">
            email us
          </a>
          .
        </p>
      </div>
    </div>
  );
}
