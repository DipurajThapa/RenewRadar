import { SettingsNav } from "@ui/features/settings/settings-nav";
import { PageHeader } from "@ui/components/shared/page-header";

/**
 * Settings shell — a left-rail sub-nav next to the panel content.
 *
 * The PageHeader sets the title at a generous size so the settings space
 * reads as a peer to other top-level pages, not a "nested" UI.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader>
        <PageHeader.Title>Settings</PageHeader.Title>
        <PageHeader.Description>
          Account, team, notifications, integrations, billing, and audit log.
        </PageHeader.Description>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8">
        <SettingsNav />
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </div>
  );
}
