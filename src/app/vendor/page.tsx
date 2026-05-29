import { redirect } from "next/navigation";
import { getCurrentVendor } from "@server/middleware/current-vendor";

/**
 * /vendor — single-purpose router. Already signed in → dashboard.
 * Otherwise → sign-in page.
 */
export const dynamic = "force-dynamic";

export default async function VendorRoot() {
  const vendor = await getCurrentVendor();
  if (vendor) {
    redirect("/vendor/dashboard");
  }
  redirect("/vendor/sign-in");
}
