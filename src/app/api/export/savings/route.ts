import { NextResponse } from "next/server";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listSavingsForAccount } from "@server/infrastructure/db/repositories/savings";
import { formatCurrencyCsv } from "@server/infrastructure/csv/format-helpers";

export const dynamic = "force-dynamic";

const HEADERS = [
  "decision_date",
  "vendor",
  "product",
  "kind",
  "baseline_annual_usd",
  "new_annual_usd",
  "saved_annual_usd",
  "locked",
  "note",
] as const;

export async function GET() {
  const { account } = await getCurrentAccountAndUser();
  const rows = await listSavingsForAccount(account.id, { limit: 2000 });

  const lines: string[] = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt.toISOString().split("T")[0]!,
        escape(r.vendorName),
        escape(r.productName),
        r.kind,
        formatCurrencyCsv(r.baselineAnnualUsdCents),
        formatCurrencyCsv(r.newAnnualUsdCents),
        formatCurrencyCsv(r.savedAnnualUsdCents),
        r.isLocked ? "true" : "false",
        escape(r.note ?? ""),
      ].join(",")
    );
  }

  const csv = lines.join("\n") + "\n";
  const filename = `renewal-radar-savings-${new Date()
    .toISOString()
    .split("T")[0]}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function escape(v: string): string {
  if (v === "") return "";
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
