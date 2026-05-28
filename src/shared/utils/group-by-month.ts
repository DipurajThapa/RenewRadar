/**
 * Generic month-grouping helper for any list of rows that has a date field.
 *
 * Used by the Notice Deadline Calendar and the Renewal Calendar to bucket
 * rows under "May 2026", "June 2026", etc. Keeps the chronological order of
 * the source array.
 *
 * @example
 *   const groups = groupByMonth(rows, (r) => r.noticeDeadline);
 *   // groups = [{ monthKey: "2026-05", monthLabel: "May 2026", rows: [...] }, ...]
 */

export type MonthGroup<T> = {
  monthKey: string; // YYYY-MM
  monthLabel: string; // e.g. "May 2026"
  rows: T[];
};

export function groupByMonth<T>(
  rows: T[],
  pickDate: (row: T) => string | Date
): MonthGroup<T>[] {
  const map = new Map<string, T[]>();

  for (const row of rows) {
    const raw = pickDate(row);
    const date =
      typeof raw === "string" ? new Date(`${raw}T00:00:00Z`) : new Date(raw);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }

  return Array.from(map.entries()).map(([key, groupRows]) => {
    const [year, month] = key.split("-");
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return {
      monthKey: key,
      monthLabel: d.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      rows: groupRows,
    };
  });
}
