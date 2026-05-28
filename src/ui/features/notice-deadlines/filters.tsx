"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/primitives/select";
import type { NoticeDeadlineFilter } from "@server/infrastructure/db/repositories/notice-deadlines";

// parseRange / parseStatus live in @/lib/notice-deadline/parse —
// pure functions can't be exported from a "use client" module and called
// from server components.

export function NoticeDeadlineFilters({
  filter,
}: {
  filter: NoticeDeadlineFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string, defaultValue?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== defaultValue) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <FilterLabel>Range</FilterLabel>
      <Select
        value={String(filter.range)}
        onValueChange={(v) => updateParam("range", v, "90")}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="30">Next 30 days</SelectItem>
          <SelectItem value="90">Next 90 days</SelectItem>
          <SelectItem value="365">Next 12 months</SelectItem>
        </SelectContent>
      </Select>

      <FilterLabel>Status</FilterLabel>
      <Select
        value={filter.status}
        onValueChange={(v) => updateParam("status", v, "all")}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="action_needed">Action needed</SelectItem>
          <SelectItem value="notice_window">In notice window</SelectItem>
          <SelectItem value="upcoming">Upcoming</SelectItem>
          <SelectItem value="missed">Missed</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
