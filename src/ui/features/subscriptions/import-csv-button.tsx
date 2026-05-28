"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Check, AlertCircle } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ui/components/primitives/dialog";
import { useToast } from "@ui/hooks/use-toast";
import {
  importSubscriptionsCsvAction,
  type ImportResult,
  type ImportRowResult,
} from "@/app/(app)/subscriptions/import-actions";
import type { AccountUserOption } from "@server/infrastructure/db/repositories/users";

type Props = {
  users: AccountUserOption[];
  currentUserId: string;
};

/**
 * Import-from-CSV modal.
 *
 * Two ways to provide content:
 *   1. Upload a file (FileReader text read, client-side)
 *   2. Paste content into the textarea
 *
 * The user always sees a per-row result table after import — even on full
 * success — so they have proof of what was created vs. skipped. Skipped rows
 * include the original line number so the user can find them in their
 * source file.
 *
 * Note: the `users` and `currentUserId` props are unused inside the dialog
 * itself but accepted because the parent passes them through alongside the
 * Add button (kept symmetric for future "Set default owner" UI).
 */
export function ImportCsvButton({ users: _users, currentUserId: _currentUserId }: Props) {
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ""));
    };
    reader.readAsText(file);
  }

  function handleSubmit() {
    setResult(null);
    startTransition(async () => {
      const r = await importSubscriptionsCsvAction(csvText);
      setResult(r);
      if (r.ok && r.imported > 0) {
        router.refresh();
        toast({
          title: `Imported ${r.imported} subscription${r.imported === 1 ? "" : "s"}`,
          description:
            r.skipped > 0
              ? `${r.skipped} row${r.skipped === 1 ? "" : "s"} skipped. See details below.`
              : "All rows imported cleanly.",
        });
      }
    });
  }

  function handleClose(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setCsvText("");
      setResult(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import CSV
      </Button>

      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Import subscriptions from CSV</DialogTitle>
          <DialogDescription>
            Use the column names below. Export a sample CSV first if you want
            a template — it round-trips losslessly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RequiredColumnsHint />

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
            >
              Choose file…
            </Button>
            <span className="text-xs text-muted-foreground">
              or paste below
            </span>
          </div>

          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={10}
            placeholder="vendor,product,billing_cycle,term_start,term_end,..."
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={pending}
          />

          {result && !result.ok && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <div className="font-medium">{result.formError}</div>
              {result.missingColumns && result.missingColumns.length > 0 && (
                <ul className="mt-1 text-xs list-disc list-inside">
                  {result.missingColumns.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {result && result.ok && (
            <ResultPanel
              imported={result.imported}
              skipped={result.skipped}
              rows={result.rowResults}
            />
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={pending}
            >
              {result?.ok && result.imported > 0 ? "Done" : "Cancel"}
            </Button>
            <Button onClick={handleSubmit} disabled={pending || csvText.trim() === ""}>
              {pending ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequiredColumnsHint() {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Required columns:</span>{" "}
      <code>vendor</code>, <code>product</code>, <code>billing_cycle</code>{" "}
      (monthly/quarterly/annual/multi_year), <code>term_start</code>,{" "}
      <code>term_end</code> (YYYY-MM-DD), <code>notice_period_days</code>,{" "}
      <code>seats</code>, <code>unit_price_usd</code>, <code>auto_renew</code>{" "}
      (true/false).{" "}
      <span className="text-foreground">Optional:</span>{" "}
      <code>plan</code>, <code>owner_email</code>, <code>notes</code>,{" "}
      <code>status</code>.
    </div>
  );
}

function ResultPanel({
  imported,
  skipped,
  rows,
}: {
  imported: number;
  skipped: number;
  rows: ImportRowResult[];
}) {
  const failures = rows.filter((r) => !r.ok);

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-green-50 border-green-200 px-4 py-3 text-sm text-green-900 flex items-center gap-2">
        <Check className="h-4 w-4" />
        Imported {imported} · Skipped {skipped}
      </div>

      {failures.length > 0 && (
        <div className="rounded-md border bg-amber-50 border-amber-200 px-4 py-3 text-sm text-amber-900">
          <div className="font-medium flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4" />
            Rows skipped
          </div>
          <ul className="space-y-1 text-xs max-h-[200px] overflow-y-auto">
            {failures.map((row) => (
              <li
                key={row.rowNumber}
                className="grid grid-cols-[auto_1fr] gap-2"
              >
                <span className="font-mono">row {row.rowNumber}:</span>
                <span>
                  {!row.ok && row.errors.join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
