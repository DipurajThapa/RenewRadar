import { Megaphone } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listVendorUpdates } from "@server/application/vendor-portal/customer-inbox";
import { PageHeader } from "@ui/components/shared/page-header";
import { VendorUpdateCard } from "@ui/features/vendor-memory/vendor-update-card";

export const dynamic = "force-dynamic";

export default async function VendorUpdatesPage() {
  const { account, user } = await getCurrentAccountAndUser();
  const updates = await listVendorUpdates(account.id);
  const canBlock = user.role === "owner" || user.role === "admin";

  const active = updates.filter(
    (u) => u.status === "delivered" || u.status === "read"
  );
  const archived = updates.filter(
    (u) => u.status === "accepted" || u.status === "dismissed"
  );

  return (
    <div className="space-y-8 max-w-3xl">
      <PageHeader>
        <PageHeader.Title>Vendor updates</PageHeader.Title>
        <PageHeader.Description>
          Price changes, renewal reminders, and EOL notices from vendors
          you&apos;ve connected with. You decide what to do with each one —
          Renewal Radar never acts on your behalf.
        </PageHeader.Description>
      </PageHeader>

      {updates.length === 0 ? (
        <div className="rounded-md border border-dashed bg-background p-10 text-center">
          <Megaphone className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No vendor updates yet. Connect with a verified vendor from their
            page under Vendors to start receiving their notices here.
          </p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Needs your attention ({active.length})
              </h2>
              {active.map((u) => (
                <VendorUpdateCard
                  key={u.deliveryId}
                  deliveryId={u.deliveryId}
                  vendorOrgId={u.vendorOrgId}
                  vendorName={u.vendorName}
                  vendorVerified={u.vendorVerified}
                  kindLabel={u.kindLabel}
                  title={u.title}
                  body={u.body}
                  effectiveDate={u.effectiveDate}
                  status={u.status}
                  reported={u.reportedAt !== null}
                  canBlock={canBlock}
                />
              ))}
            </section>
          )}

          {archived.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Handled ({archived.length})
              </h2>
              {archived.map((u) => (
                <VendorUpdateCard
                  key={u.deliveryId}
                  deliveryId={u.deliveryId}
                  vendorOrgId={u.vendorOrgId}
                  vendorName={u.vendorName}
                  vendorVerified={u.vendorVerified}
                  kindLabel={u.kindLabel}
                  title={u.title}
                  body={u.body}
                  effectiveDate={u.effectiveDate}
                  status={u.status}
                  reported={u.reportedAt !== null}
                  canBlock={canBlock}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
