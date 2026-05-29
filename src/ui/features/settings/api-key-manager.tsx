"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, AlertCircle, Trash2 } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/primitives/dialog";
import { Label } from "@ui/components/primitives/label";
import { useToast } from "@ui/hooks/use-toast";
import {
  createApiKeyAction,
  revokeApiKeyAction,
} from "@app/(app)/settings/api-keys/actions";

type KeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function ApiKeyManager({
  canManage,
  keys,
}: {
  canManage: boolean;
  keys: KeyRow[];
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [readScope, setReadScope] = useState(true);
  const [writeScope, setWriteScope] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newKey, setNewKey] = useState<{
    raw: string;
    prefix: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  function handleCreate() {
    setError(null);
    const scopes: ("subscriptions:read" | "subscriptions:write")[] = [];
    if (readScope) scopes.push("subscriptions:read");
    if (writeScope) scopes.push("subscriptions:write");
    if (scopes.length === 0) {
      setError("Pick at least one scope.");
      return;
    }
    startTransition(async () => {
      const r = await createApiKeyAction({ name, scopes });
      if (!r.ok) {
        setError(r.formError);
        return;
      }
      setNewKey({ raw: r.rawKey, prefix: r.keyPrefix, name: r.name });
      setName("");
      setReadScope(true);
      setWriteScope(false);
      router.refresh();
    });
  }

  function handleRevoke(id: string) {
    if (!confirm("Revoke this key? Any service using it will start receiving 401s immediately.")) {
      return;
    }
    startTransition(async () => {
      const r = await revokeApiKeyAction(id);
      if (!r.ok) {
        toast({ title: "Revoke failed", description: r.error ?? "Unknown error" });
        return;
      }
      router.refresh();
      toast({ title: "Key revoked" });
    });
  }

  async function copyRaw() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey.raw);
      toast({ title: "Copied to clipboard" });
    } catch {
      // Clipboard refused — fall through, user can copy manually.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <div className="text-sm text-muted-foreground">
          {keys.length === 0
            ? "No API keys yet."
            : `${keys.filter((k) => !k.revokedAt).length} active · ${keys.filter((k) => k.revokedAt).length} revoked`}
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)} variant="outline">
            New API key
          </Button>
        )}
      </div>

      <ul className="rounded-md border divide-y bg-background">
        {keys.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No keys to show.
          </li>
        ) : (
          keys.map((k) => (
            <li key={k.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">
                  {k.name}
                  {k.revokedAt && (
                    <span className="ml-2 text-xs text-red-700">
                      · revoked
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  rr_pk_{k.keyPrefix}…{" "}
                  <span className="px-1">·</span>
                  {k.scopes.join(", ")}
                  <span className="px-1">·</span>
                  {k.lastUsedAt
                    ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                    : "never used"}
                </div>
              </div>
              {canManage && !k.revokedAt && (
                <button
                  type="button"
                  onClick={() => handleRevoke(k.id)}
                  disabled={pending}
                  className="text-xs text-red-700 hover:text-red-900 inline-flex items-center gap-1"
                  title="Revoke this key"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              )}
            </li>
          ))
        )}
      </ul>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={(v) => !pending && setCreating(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Give the key a meaningful name (e.g. &quot;Production
              backend&quot;). You&apos;ll see the full key value exactly once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="key-name">Name</Label>
              <input
                id="key-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                placeholder="Production backend"
                className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Scopes</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={readScope}
                  onChange={(e) => setReadScope(e.target.checked)}
                  disabled={pending}
                />
                <code className="text-xs">subscriptions:read</code>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={writeScope}
                  onChange={(e) => setWriteScope(e.target.checked)}
                  disabled={pending}
                />
                <code className="text-xs">subscriptions:write</code>
              </label>
            </div>
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCreating(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={pending || name.trim() === ""}
            >
              {pending ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show-the-key-once dialog. */}
      <Dialog
        open={newKey !== null}
        onOpenChange={(v) => {
          if (!v) {
            setNewKey(null);
            setCreating(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save your API key now</DialogTitle>
            <DialogDescription>
              This is the only time we&apos;ll show the full key. Copy it
              somewhere safe — we store only a hash on our side.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
            {newKey?.raw}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={copyRaw}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
            <Button onClick={() => setNewKey(null)}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
