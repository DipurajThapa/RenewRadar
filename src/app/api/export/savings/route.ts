import { NextResponse } from "next/server";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { tierFeatureDeniedResponse } from "@server/middleware/tier-feature-response";
import {
  requireTierFeature,
  TierFeatureDeniedError,
} from "@server/domain/billing/tier-features";
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
  "saved_annual_usd_projected",
  // Reconciliation (proven) columns — what actually happened vs. what the
  // decision projected. Omitting these made an exported "savings" report show
  // only projections, never the proven figure.
  "realized_new_annual_usd",
  "saved_annual_usd_realized",
  "reconciliation_status",
  "reconciled_date",
  "locked",
  "note",
] as const;

export async function GET() {
  const { account } = await getCurrentAccountAndUser();

  // Savings export is a Growth+ feature (savings ledger itself is Growth+).
  try {
    requireTierFeature(account.planTier, "savingsReports");
  } catch (err) {
    if (err instanceof TierFeatureDeniedError) {
      return tierFeatureDeniedResponse(err);
    }
    throw err;
  }

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
        r.realizedNewAnnualUsdCents != null
          ? formatCurrencyCsv(r.realizedNewAnnualUsdCents)
          : "",
        r.realizedSavedAnnualUsdCents != null
          ? formatCurrencyCsv(r.realizedSavedAnnualUsdCents)
          : "",
        r.reconciliationStatus ?? "pending",
        r.reconciledAt ? r.reconciledAt.toISOString().split("T")[0]! : "",
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
  // Neutralize spreadsheet formula injection ( =, +, -, @, tab, CR ) before
  // RFC-4180 quoting — user-controlled vendor names / notes flow through here.
  let safe = v;
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = "'" + safe;
  }
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
