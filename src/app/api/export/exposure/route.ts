import { NextResponse } from "next/server";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { tierFeatureDeniedResponse } from "@server/middleware/tier-feature-response";
import {
  requireTierFeature,
  TierFeatureDeniedError,
} from "@server/domain/billing/tier-features";
import { listExposureDetail } from "@server/infrastructure/db/repositories/reports";
import { formatCurrencyCsv } from "@server/infrastructure/csv/format-helpers";

export const dynamic = "force-dynamic";

const HEADERS = [
  "vendor",
  "product",
  "status",
  "renewal_date",
  "notice_deadline",
  "annual_value_usd",
] as const;

export async function GET() {
  const { account } = await getCurrentAccountAndUser();

  // CSV export is a Starter+ feature.
  try {
    requireTierFeature(account.planTier, "csvImportExport");
  } catch (err) {
    if (err instanceof TierFeatureDeniedError) {
      return tierFeatureDeniedResponse(err);
    }
    throw err;
  }

  const rows = await listExposureDetail(account.id, 365);

  const lines: string[] = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escape(r.vendorName),
        escape(r.productName),
        r.status,
        r.renewalDate,
        r.noticeDeadline,
        formatCurrencyCsv(r.annualValueCents),
      ].join(",")
    );
  }

  const csv = lines.join("\n") + "\n";
  const filename = `renewal-radar-exposure-${new Date()
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
