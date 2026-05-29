"use server";

/**
 * T4.10 Slice 4 — vendor announcement actions.
 * Gated by `requireCurrentVendor`; exempt from customer RBAC/audit coverage
 * via the `src/app/vendor/` prefix.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentVendor } from "@server/middleware/current-vendor";
import {
  createAnnouncement,
  publishAnnouncement,
  VendorAnnouncementError,
} from "@server/application/vendor-portal/announcements";
import type { VendorAnnouncementKind } from "@server/infrastructure/db/schema";

const VALID_KINDS: VendorAnnouncementKind[] = [
  "price_change",
  "renewal_reminder",
  "eol",
  "general",
];

export type PublishResult = { ok: true } | { ok: false; error: string };

export async function publishAnnouncementAction(
  announcementId: string
): Promise<PublishResult> {
  const { vendorOrg, vendorUser } = await requireCurrentVendor();
  try {
    await publishAnnouncement({
      announcementId,
      vendorOrgId: vendorOrg.id,
      vendorUserId: vendorUser.id,
    });
    revalidatePath("/vendor/announcements");
    return { ok: true };
  } catch (err) {
    if (err instanceof VendorAnnouncementError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Form action for the compose page. `intent` is "draft" or "publish".
 * On error, redirects back to /new with the message.
 */
export async function composeAnnouncementAction(formData: FormData): Promise<void> {
  const { vendorOrg, vendorUser } = await requireCurrentVendor();

  const kindRaw = String(formData.get("kind") ?? "general");
  const kind = (VALID_KINDS as string[]).includes(kindRaw)
    ? (kindRaw as VendorAnnouncementKind)
    : "general";
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  const effectiveDate = formData.get("effectiveDate")?.toString() || null;
  const intent = String(formData.get("intent") ?? "draft");

  try {
    const draft = await createAnnouncement({
      vendorOrgId: vendorOrg.id,
      vendorUserId: vendorUser.id,
      kind,
      title,
      body,
      effectiveDate,
    });
    if (intent === "publish") {
      await publishAnnouncement({
        announcementId: draft.id,
        vendorOrgId: vendorOrg.id,
        vendorUserId: vendorUser.id,
      });
    }
  } catch (err) {
    if (err instanceof VendorAnnouncementError) {
      redirect(`/vendor/announcements/new?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect("/vendor/announcements");
}
