import { redirect } from "next/navigation";
import { redeemMagicLinkAction } from "@app/vendor/actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Signing in · Vendor portal",
  robots: { index: false, follow: false },
};

/**
 * Magic-link landing page. Reads `token` from the URL, hands it to the
 * server action, which either sets the session cookie and redirects to
 * /vendor/dashboard or bounces back to /vendor/sign-in with an error.
 *
 * Why a page (not an API route): we want to set cookies + redirect using
 * the standard Server Action idiom that returns `never`. A GET route would
 * require manual `NextResponse.redirect` + `Set-Cookie`, which is also
 * fine but loses the framework's cookie helpers.
 */
export default async function VendorAuthCallbackPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const token = (sp.token ?? "").trim();
  if (!token) {
    redirect("/vendor/sign-in?error=Missing+sign-in+token");
  }
  // Hand off to the action — it redirects on both success and failure.
  await redeemMagicLinkAction(token);
  // Unreachable; redirect throws.
  return null;
}
