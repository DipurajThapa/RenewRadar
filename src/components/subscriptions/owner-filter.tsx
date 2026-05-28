"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AccountUserOption } from "@/lib/db/queries/users";

/**
 * URL-driven owner filter for the subscriptions list.
 *
 * Reads/writes a single `owner` search param:
 *   - missing       → all owners
 *   - "unassigned"  → only subscriptions with no owner
 *   - "<userId>"    → only that user's subscriptions
 *
 * Driving state through the URL means filters survive refresh, are deep-linkable,
 * and let the server fetch the right slice without a client-side data store.
 */
export function OwnerFilter({ users }: { users: AccountUserOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("owner") ?? "__all__";

  function setValue(v: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (v === "__all__") {
      next.delete("owner");
    } else {
      next.set("owner", v);
    }
    const query = next.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`);
  }

  return (
    <Select value={current} onValueChange={setValue}>
      <SelectTrigger className="w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All owners</SelectItem>
        <SelectItem value="unassigned">Unassigned</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.fullName ?? u.workEmail}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
