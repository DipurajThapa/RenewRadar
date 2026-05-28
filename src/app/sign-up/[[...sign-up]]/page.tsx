import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden>⚡</span>
            <span>Renewal Radar</span>
          </Link>
          <p className="text-sm text-muted-foreground mt-1">
            Free Forever · 14-day Starter trial · no credit card
          </p>
        </div>
        <SignUp />
      </div>
    </div>
  );
}
