"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Check,
  AlertCircle,
  AlertTriangle,
  Plus,
  ArrowLeft,
  Copy,
} from "lucide-react";
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
  bulkReassignOwnersAction,
  importSubscriptionsCsvAction,
  previewSubscriptionsImportAction,
  undoImportBatchAction,
  type ImportResult,
  type ImportRowResult,
  type PreviewResult,
  type PreviewRowResult,
} from "@app/(app)/subscriptions/import-actions";
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
export function ImportCsvButton({ users, currentUserId }: Props) {
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  /**
   * Four-state state machine:
   *   - "input": user pastes / uploads CSV
   *   - "preview": dry-run done, summary shown, awaiting confirm or back
   *   - "result": commit ran, per-row results visible; optional "Assign owners"
   *     button moves to the assign step
   *   - "assign": post-import owner reassignment (T2.6) — list of created
   *     rows with a dropdown per row + quick "set all to X"
   */
  const [phase, setPhase] = useState<"input" | "preview" | "result" | "assign">(
    "input"
  );
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  /**
   * Working state for the assign step: subscriptionId → ownerUserId (or
   * null to unassign). Seeded from the import result so the user starts
   * from "what we wrote" and edits from there.
   */
  const [assignments, setAssignments] = useState<Record<string, string | null>>(
    {}
  );
  const [assignError, setAssignError] = useState<string | null>(null);
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

  function handlePreview() {
    setResult(null);
    setPreview(null);
    startTransition(async () => {
      const r = await previewSubscriptionsImportAction(csvText);
      setPreview(r);
      if (r.ok) {
        setPhase("preview");
      }
    });
  }

  function handleCommit() {
    if (!preview || !preview.ok) return;
    startTransition(async () => {
      const r = await importSubscriptionsCsvAction(csvText);
      setResult(r);
      setPhase("result");
      if (r.ok && r.imported > 0) {
        router.refresh();
        // Seed the assignment state from what the import wrote, so the
        // user starts on the same value and can edit from there.
        const seed: Record<string, string | null> = {};
        for (const row of r.rowResults) {
          if (row.ok) seed[row.subscriptionId] = row.assignedOwnerUserId;
        }
        setAssignments(seed);
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

  function handleStartAssign() {
    setAssignError(null);
    setPhase("assign");
  }

  function handleSetAll(ownerUserId: string) {
    setAssignments((prev) => {
      const next: Record<string, string | null> = {};
      for (const id of Object.keys(prev)) next[id] = ownerUserId;
      return next;
    });
  }

  function handleAssignOne(subscriptionId: string, ownerUserId: string | null) {
    setAssignments((prev) => ({ ...prev, [subscriptionId]: ownerUserId }));
  }

  function handleCommitAssignments() {
    const entries = Object.entries(assignments).map(
      ([subscriptionId, ownerUserId]) => ({ subscriptionId, ownerUserId })
    );
    if (entries.length === 0) {
      handleClose(false);
      return;
    }
    setAssignError(null);
    startTransition(async () => {
      const r = await bulkReassignOwnersAction({ assignments: entries });
      if (!r.ok) {
        setAssignError(r.formError);
        return;
      }
      router.refresh();
      toast({
        title:
          r.failed === 0
            ? `Owners updated on ${r.updated} subscription${r.updated === 1 ? "" : "s"}`
            : `${r.updated} updated, ${r.failed} failed`,
        description:
          r.failed === 0
            ? "All assignments applied."
            : r.failures
                .slice(0, 3)
                .map((f) => f.error)
                .join(" · "),
      });
      handleClose(false);
    });
  }

  function handleBackToInput() {
    setPhase("input");
    setPreview(null);
    setResult(null);
  }

  function handleClose(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setCsvText("");
      setPreview(null);
      setResult(null);
      setAssignments({});
      setAssignError(null);
      setPhase("input");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import from spreadsheet
      </Button>

      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Import subscriptions</DialogTitle>
          <DialogDescription>
            Upload a CSV, or paste straight from Excel or Google Sheets — we
            accept both formats. Need a starting point?{" "}
            <a
              href="/api/subscriptions/sample-csv"
              className="underline underline-offset-2 hover:text-foreground"
              download
            >
              Download a sample CSV
            </a>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {phase === "input" && (
            <>
              <RequiredColumnsHint />

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv,.tsv,text/tab-separated-values"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pending}
                >
                  Choose CSV file…
                </Button>
                <span className="text-xs text-muted-foreground">
                  or paste from Excel / Google Sheets below
                </span>
              </div>

              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={10}
                placeholder={`Paste cells from Excel here — we'll detect tab- or comma-separated automatically.\n\nExample:\nvendor,product,billing_cycle,term_start,term_end,notice_period_days,seats,unit_price_usd,auto_renew\nSlack,Business+,annual,2026-01-01,2027-01-01,60,100,150,true`}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={pending}
              />

              {preview && !preview.ok && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  <div className="font-medium">{preview.formError}</div>
                  {preview.missingColumns &&
                    preview.missingColumns.length > 0 && (
                      <ul className="mt-1 text-xs list-disc list-inside">
                        {preview.missingColumns.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => handleClose(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handlePreview}
                  disabled={pending || csvText.trim() === ""}
                >
                  {pending ? "Checking…" : "Preview import"}
                </Button>
              </div>
            </>
          )}

          {phase === "preview" && preview && preview.ok && (
            <>
              <PreviewSummary preview={preview} />

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={handleBackToInput}
                  disabled={pending}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={handleCommit}
                  disabled={pending || preview.wouldCreate === 0}
                >
                  {pending
                    ? "Importing…"
                    : preview.wouldCreate === 0
                      ? "Nothing to import"
                      : `Confirm — create ${preview.wouldCreate}`}
                </Button>
              </div>
            </>
          )}

          {phase === "result" && result && result.ok && (
            <>
              <ResultPanel
                imported={result.imported}
                skipped={result.skipped}
                rows={result.rowResults}
              />

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                {result.imported > 0 && result.importBatchId && (
                  <UndoImportButton
                    batchId={result.importBatchId}
                    onUndone={() => handleClose(false)}
                  />
                )}
                {result.imported > 0 && (
                  <Button variant="outline" onClick={handleStartAssign}>
                    Assign owners
                  </Button>
                )}
                <Button onClick={() => handleClose(false)}>Done</Button>
              </div>
            </>
          )}

          {phase === "assign" && result && result.ok && (
            <AssignOwnersPanel
              importedRows={result.rowResults.filter(
                (r): r is Extract<ImportRowResult, { ok: true }> => r.ok
              )}
              users={users}
              currentUserId={currentUserId}
              assignments={assignments}
              onAssignOne={handleAssignOne}
              onSetAll={handleSetAll}
              error={assignError}
              pending={pending}
              onBack={() => setPhase("result")}
              onCommit={handleCommitAssignments}
            />
          )}

          {phase === "result" && result && !result.ok && (
            <>
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <div className="font-medium">{result.formError}</div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={handleBackToInput}>
                  Try again
                </Button>
                <Button onClick={() => handleClose(false)}>Close</Button>
              </div>
            </>
          )}
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

/**
 * Preview-summary panel — what the diff would do if the user confirmed.
 * Renders four buckets (create, duplicate, invalid, over-capacity) and an
 * expandable detail list so customers can verify the import before any
 * write. The "Back" button leaves text intact so they can edit and re-run.
 */
function PreviewSummary({
  preview,
}: {
  preview: Extract<PreviewResult, { ok: true }>;
}) {
  const { wouldCreate, duplicateExisting, invalid, overCapacity, rows } =
    preview;
  const total = rows.length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile
          label="Will create"
          value={wouldCreate}
          tone="ok"
          icon={<Plus className="h-3.5 w-3.5" />}
        />
        <SummaryTile
          label="Already exist"
          value={duplicateExisting}
          tone="warn"
          icon={<Copy className="h-3.5 w-3.5" />}
        />
        <SummaryTile
          label="Invalid"
          value={invalid}
          tone="error"
          icon={<AlertCircle className="h-3.5 w-3.5" />}
        />
        <SummaryTile
          label="Over plan limit"
          value={overCapacity}
          tone="error"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        {total} row{total === 1 ? "" : "s"} parsed.{" "}
        {wouldCreate === 0
          ? "Nothing would be created — nothing to confirm."
          : `Click "Confirm" to create the ${wouldCreate} new row${wouldCreate === 1 ? "" : "s"}. Nothing else is touched.`}
      </div>

      {rows.length > 0 && (
        <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer select-none font-medium">
            Per-row details
          </summary>
          <ul className="mt-2 space-y-1 max-h-[260px] overflow-y-auto">
            {rows.map((r) => (
              <li
                key={r.rowNumber}
                className="grid grid-cols-[auto_1fr_auto] gap-2 items-baseline"
              >
                <span className="font-mono text-muted-foreground">
                  row {r.rowNumber}:
                </span>
                <PreviewRowLine row={r} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "error";
  icon: React.ReactNode;
}) {
  const palette =
    tone === "ok"
      ? "bg-green-50 border-green-200 text-green-900"
      : tone === "warn"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : "bg-red-50 border-red-200 text-red-900";
  return (
    <div className={`rounded-md border px-3 py-2 ${palette}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function PreviewRowLine({ row }: { row: PreviewRowResult }) {
  if (!row.ok) {
    return (
      <>
        <span className="truncate text-amber-800">{row.errors.join(" · ")}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {row.reason}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="truncate">
        {row.vendor} <span className="text-muted-foreground">·</span>{" "}
        {row.product}
      </span>
      <span
        className={`text-[10px] uppercase tracking-wide ${
          row.classification === "would_create"
            ? "text-green-700"
            : "text-amber-700"
        }`}
      >
        {row.classification === "would_create" ? "new" : "duplicate"}
      </span>
    </>
  );
}

/**
 * Post-import owner-assignment step (T2.6).
 *
 * Shows the freshly-created rows with a per-row owner dropdown. Includes a
 * "Set all to X" quick-pick because for a CSV import the typical pattern is
 * "I'll own these all" or "give these to my team lead" — both should be one
 * click, not 47.
 */
function AssignOwnersPanel({
  importedRows,
  users,
  currentUserId,
  assignments,
  onAssignOne,
  onSetAll,
  error,
  pending,
  onBack,
  onCommit,
}: {
  importedRows: Array<Extract<ImportRowResult, { ok: true }>>;
  users: AccountUserOption[];
  currentUserId: string;
  assignments: Record<string, string | null>;
  onAssignOne: (subscriptionId: string, ownerUserId: string | null) => void;
  onSetAll: (ownerUserId: string) => void;
  error: string | null;
  pending: boolean;
  onBack: () => void;
  onCommit: () => void;
}) {
  const userById = new Map(users.map((u) => [u.id, u]));
  const me = userById.get(currentUserId);
  const currentUserName = me?.fullName ?? me?.workEmail ?? "me";

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-2">
        <div className="font-medium text-foreground text-sm">
          Reassign owners
        </div>
        <div className="text-muted-foreground">
          Each row was assigned to its `owner_email` from the CSV, or to you
          ({currentUserName}) when none was provided. Adjust below — owners
          receive renewal alerts and digest emails for the subscriptions they
          own.
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-muted-foreground">Quick:</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSetAll(currentUserId)}
            className="rounded border px-2 py-0.5 text-[11px] hover:bg-background"
          >
            Set all to me
          </button>
          {users
            .filter((u) => u.id !== currentUserId)
            .slice(0, 3)
            .map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={pending}
                onClick={() => onSetAll(u.id)}
                className="rounded border px-2 py-0.5 text-[11px] hover:bg-background"
              >
                Set all to {(u.fullName ?? u.workEmail)}
              </button>
            ))}
        </div>
      </div>

      <ul className="space-y-1.5 max-h-[320px] overflow-y-auto rounded-md border bg-background p-2 text-sm">
        {importedRows.map((row) => (
          <li
            key={row.subscriptionId}
            className="grid grid-cols-[1fr_minmax(180px,auto)] gap-3 items-center px-2 py-1.5"
          >
            <div className="truncate">
              <span className="font-medium">{row.vendor}</span>
              <span className="text-muted-foreground"> · {row.product}</span>
            </div>
            <select
              disabled={pending}
              value={assignments[row.subscriptionId] ?? ""}
              onChange={(e) =>
                onAssignOne(
                  row.subscriptionId,
                  e.target.value === "" ? null : e.target.value
                )
              }
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.fullName ?? u.workEmail)}
                  {u.id === currentUserId ? " (me)" : ""}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-1">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onCommit} disabled={pending}>
          {pending ? "Saving…" : "Save assignments"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Undo-import button (T4.15). Lives on the import result panel; calls the
 * undo action which is guarded server-side to a 24-hour window.
 */
function UndoImportButton({
  batchId,
  onUndone,
}: {
  batchId: string;
  onUndone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleClick() {
    startTransition(async () => {
      const r = await undoImportBatchAction(batchId);
      if (!r.ok) {
        toast({
          title: "Undo failed",
          description: r.formError,
        });
        return;
      }
      router.refresh();
      toast({
        title: `Undid import (${r.undoneCount} cancelled)`,
        description:
          "Subscriptions you'd modified manually were left as-is — only fresh rows from the import were rolled back.",
      });
      onUndone();
    });
  }

  return (
    <Button
      variant="outline"
      onClick={handleClick}
      disabled={pending}
      title="Cancel every subscription this import created. Available for 24 hours."
    >
      {pending ? "Undoing…" : "Undo this import"}
    </Button>
  );
}
