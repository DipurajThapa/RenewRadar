"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { staffImportCsvForAccountAction } from "@app/staff/actions";

/**
 * Concierge CSV import panel (T4.1).
 *
 * Mirrors the customer-side import dialog but slimmer — no preview step
 * because the staff operator is expected to have already validated the
 * file with the customer offline. The result panel shows per-row outcomes
 * so the operator can copy them into the support ticket.
 */
export function StaffCsvImportPanel({ accountId }: { accountId: string }) {
  const [csvText, setCsvText] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    rowResults: Array<
      | { ok: true; rowNumber: number; subscriptionId: string }
      | { ok: false; rowNumber: number; errors: string[]; reason?: string }
    >;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await staffImportCsvForAccountAction({
        accountId,
        csvText,
      });
      if (!r.ok) {
        setError(r.formError);
        return;
      }
      setResult({
        imported: r.imported,
        skipped: r.skipped,
        rowResults: r.rowResults,
      });
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border bg-background p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste a CSV (or TSV from Excel) and click <em>Import</em>. The customer
        keeps full Undo access for 24 hours on the resulting batch.
      </p>
      <textarea
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        rows={10}
        placeholder="vendor,product,billing_cycle,term_start,term_end,notice_period_days,seats,unit_price_usd,auto_renew"
        className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
        disabled={pending}
      />
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-md border bg-green-50 border-green-200 px-3 py-2 text-sm text-green-900">
          Imported {result.imported} · Skipped {result.skipped}
          {result.rowResults.some((r) => !r.ok) && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer">Skipped rows</summary>
              <ul className="mt-1 space-y-0.5">
                {result.rowResults
                  .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
                  .map((r) => (
                    <li key={r.rowNumber}>
                      row {r.rowNumber}: {r.errors.join(" · ")}
                      {r.reason ? ` (${r.reason})` : ""}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending || csvText.trim() === ""}
          className="rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-3 py-1.5 text-sm font-medium"
        >
          {pending ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}
