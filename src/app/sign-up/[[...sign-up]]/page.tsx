import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { Sparkles, Zap } from "lucide-react";
import { Badge } from "@ui/components/primitives/badge";

export const metadata: Metadata = {
  title: "Sign up",
  description:
    "Create your Renewal Radar account. Free Forever (5 subscriptions), 14-day Starter trial, no credit card required.",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <div className="relative min-h-screen bg-secondary/30 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[460px] bg-gradient-to-b from-primary-soft via-background to-secondary/30"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[460px] bg-grid bg-grid-fade opacity-50"
      />

      <div className="relative flex min-h-screen flex-col">
        <header className="px-5 lg:px-8 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-semibold group"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card group-hover:bg-primary-strong transition-colors">
              <Zap className="h-4 w-4" />
            </span>
            <span className="font-display tracking-tight">Renewal Radar</span>
          </Link>
          <Link
            href="/sign-in"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Already have an account?
          </Link>
        </header>

        <main className="flex-1 flex items-center justify-center px-5 py-10">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-3">
              <Badge variant="primary-soft" className="gap-1.5 px-3 py-1">
                <Sparkles className="h-3.5 w-3.5" />
                Free Forever
              </Badge>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
                Start tracking renewals
              </h1>
              <p className="text-sm text-muted-foreground">
                Free Forever (5 subscriptions) · 14-day Starter trial · no
                credit card required
              </p>
            </div>
            <SignUp />
            <p className="text-center text-sm text-muted-foreground">
              Want to try first?{" "}
              <Link
                href="/dashboard"
                className="font-medium text-foreground hover:underline underline-offset-4"
              >
                View the live demo →
              </Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
