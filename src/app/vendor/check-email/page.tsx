import Link from "next/link";
import { Mail } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Check your email · Vendor portal",
  robots: { index: false, follow: false },
};

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams?: Promise<{ email?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const email = sp.email;

  return (
    <div className="max-w-md mx-auto text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-teal-700 mb-4">
        <Mail className="h-6 w-6" />
      </div>
      <h1 className="text-2xl font-display font-semibold tracking-tight">
        Check your email
      </h1>
      <p className="text-sm text-teal-900/70 mt-2">
        If <strong>{email ?? "your email"}</strong> is recognized, we sent a
        sign-in link. It works once and expires in 15 minutes.
      </p>
      <p className="text-sm text-teal-900/70 mt-4">
        Didn&apos;t receive it? Check spam, then{" "}
        <Link
          href="/vendor/sign-in"
          className="underline underline-offset-2 font-medium"
        >
          request a new link
        </Link>
        .
      </p>
    </div>
  );
}
