"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/primitives/select";

/**
 * URL-driven filter for the audit log viewer.
 *
 * Keeps state in `?entity=<type>` so the filter survives refresh and is
 * deep-linkable. "All" clears the param.
 */
export function AuditFilter({ entityTypes }: { entityTypes: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("entity") ?? "__all__";

  function setValue(v: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (v === "__all__") {
      next.delete("entity");
    } else {
      next.set("entity", v);
    }
    next.delete("cursor"); // entering a new filter starts a fresh page
    const query = next.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`);
  }

  return (
    <Select value={current} onValueChange={setValue}>
      <SelectTrigger className="w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All entity types</SelectItem>
        {entityTypes.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
