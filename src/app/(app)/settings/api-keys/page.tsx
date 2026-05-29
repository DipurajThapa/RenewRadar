import Link from "next/link";
import { Key } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listApiKeysForAccount } from "@server/application/api-keys";
import { PageHeader } from "@ui/components/shared/page-header";
import { ApiKeyManager } from "@ui/features/settings/api-key-manager";

/**
 * Settings → API keys. Lists current keys, lets owner/admin issue new
 * keys (full key shown ONCE) and revoke existing ones.
 */
export const dynamic = "force-dynamic";

export default async function ApiKeysSettingsPage() {
  const { account, user } = await getCurrentAccountAndUser();
  const keys = await listApiKeysForAccount(account.id);

  const canManage = user.role === "owner" || user.role === "admin";

  return (
    <div className="space-y-8 max-w-3xl">
      <PageHeader>
        <PageHeader.Title>
          <span className="inline-flex items-center gap-2">
            <Key className="h-5 w-5" />
            API keys
          </span>
        </PageHeader.Title>
        <PageHeader.Description>
          Use API keys to read or push data programmatically. Full reference
          at{" "}
          <Link
            href="/api/v1/openapi.json"
            className="underline underline-offset-2 hover:text-foreground"
          >
            /api/v1/openapi.json
          </Link>
          .
        </PageHeader.Description>
      </PageHeader>

      {!canManage && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          API key management requires owner or admin access. Read-only here for
          your role.
        </div>
      )}

      <ApiKeyManager
        canManage={canManage}
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          scopes: (k.scopesJson ?? []) as string[],
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
