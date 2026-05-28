import Link from "next/link";

const SECTIONS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/billing", label: "Plan & Billing" },
  { href: "/settings/audit", label: "Audit log" },
] as const;

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>

      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">
        <nav className="space-y-1">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="block px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
            >
              {section.label}
            </Link>
          ))}
        </nav>

        <div>{children}</div>
      </div>
    </div>
  );
}
