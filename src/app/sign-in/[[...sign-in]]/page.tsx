import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Renewal Radar account.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <div className="relative min-h-screen bg-secondary/30 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-primary-soft via-background to-secondary/30"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[420px] bg-grid bg-grid-fade opacity-50"
      />

      <div className="relative flex min-h-screen flex-col">
        <header className="px-5 lg:px-8 h-16 flex items-center">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-semibold group"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card group-hover:bg-primary-strong transition-colors">
              <Zap className="h-4 w-4" />
            </span>
            <span className="font-display tracking-tight">Renewal Radar</span>
          </Link>
        </header>

        <main className="flex-1 flex items-center justify-center px-5 py-10">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-2">
              <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
                Welcome back
              </h1>
              <p className="text-sm text-muted-foreground">
                Sign in to keep watching your renewals.
              </p>
            </div>
            <SignIn />
            <p className="text-center text-sm text-muted-foreground">
              Just looking?{" "}
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
