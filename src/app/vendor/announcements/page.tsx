import Link from "next/link";
import { Plus } from "lucide-react";
import { requireCurrentVendor } from "@server/middleware/current-vendor";
import { listAnnouncementsWithStats } from "@server/application/vendor-portal/announcements";
import { countConnectedCustomers } from "@server/application/vendor-portal/connections";
import { PublishButton } from "@ui/features/vendor/publish-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Announcements · Vendor portal",
  robots: { index: false, follow: false },
};

const KIND_LABEL: Record<string, string> = {
  price_change: "Price change",
  renewal_reminder: "Renewal reminder",
  eol: "End-of-life",
  general: "Update",
};

export default async function VendorAnnouncementsPage() {
  const { vendorOrg } = await requireCurrentVendor();
  const [announcements, connectedCount] = await Promise.all([
    listAnnouncementsWithStats(vendorOrg.id),
    countConnectedCustomers(vendorOrg.id),
  ]);

  const canPublish = vendorOrg.status === "active" && vendorOrg.domainVerifiedAt;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-semibold tracking-tight">
            Announcements
          </h1>
          <p className="text-sm text-teal-900/70 mt-1">
            Publish price changes, renewal reminders, and EOL notices to your{" "}
            {connectedCount} connected customer{connectedCount === 1 ? "" : "s"}.
          </p>
        </div>
        {canPublish ? (
          <Link
            href="/vendor/announcements/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            New announcement
          </Link>
        ) : (
          <Link
            href="/vendor/verify-domain"
            className="rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 text-sm font-medium"
          >
            Verify domain to publish
          </Link>
        )}
      </header>

      {announcements.length === 0 ? (
        <div className="rounded-md border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">
          No announcements yet. Create one to reach your connected customers.
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="rounded-md border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide rounded bg-teal-100 text-teal-800 px-1.5 py-0.5 font-semibold">
                      {KIND_LABEL[a.kind] ?? a.kind}
                    </span>
                    <span
                      className={
                        a.status === "published"
                          ? "text-[10px] uppercase tracking-wide text-teal-700"
                          : "text-[10px] uppercase tracking-wide text-amber-700"
                      }
                    >
                      {a.status}
                    </span>
                  </div>
                  <h3 className="font-medium text-sm mt-1.5">{a.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5 whitespace-pre-wrap">
                    {a.body}
                  </p>
                </div>
                {a.status === "draft" && <PublishButton announcementId={a.id} />}
              </div>

              {a.status === "published" && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground border-t pt-2">
                  <Stat label="Delivered" value={a.deliveredCount} />
                  <Stat label="Read" value={a.readCount} />
                  <Stat label="Accepted" value={a.acceptedCount} />
                  <Stat label="Dismissed" value={a.dismissedCount} />
                  {a.reportedCount > 0 && (
                    <Stat label="Reported" value={a.reportedCount} danger />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <span className={danger ? "text-red-600 font-medium" : ""}>
      <span className="tabular-nums font-medium text-foreground">{value}</span>{" "}
      {label}
    </span>
  );
}
