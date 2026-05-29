"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, AlertCircle, Check, X, Loader2 } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ui/components/primitives/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/primitives/select";
import { Label } from "@ui/components/primitives/label";
import { useToast } from "@ui/hooks/use-toast";

// Keep in lock-step with `src/server/application/documents/upload.ts`
// ALLOWED_MIME — what the server accepts, the client must not pre-reject.
const ALLOWED_EXT = [
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "csv",
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
];
const MAX_BYTES = 20 * 1024 * 1024;

// Keep in lock-step with `MAX_FILES_PER_REQUEST` in
// `src/app/api/documents/upload/route.ts`. The client chunks bigger batches
// into multiple sequential POSTs so a 50-PDF folder still works.
const FILES_PER_REQUEST = 10;

type SubscriptionOption = { id: string; label: string };

type FileEntry = {
  /** Stable id so React can key the row across status changes. */
  key: string;
  file: File;
  /**
   * - `pending`: queued, not yet sent
   * - `uploading`: in flight
   * - `succeeded`: server returned ok (new document)
   * - `duplicate`: server returned ok but this checksum was already on
   *   file — we show the prior upload date so the user understands it
   *   wasn't re-extracted
   * - `failed`: rejected (client validation or server error)
   */
  status:
    | "pending"
    | "uploading"
    | "succeeded"
    | "duplicate"
    | "failed";
  error?: string;
  /** When `status === "duplicate"`, the date the file was originally uploaded. */
  originalUploadedAt?: string;
};

type UploadResultEntry =
  | {
      ok: true;
      filename: string;
      documentId: string;
      alreadyExisted: boolean;
      originalUploadedAt: string;
    }
  | { ok: false; filename: string; error: string };

type UploadResponse =
  | {
      ok: true;
      results: UploadResultEntry[];
      uploaded: number;
      skipped: number;
    }
  | { ok: false; error: string };

export function UploadDocumentButton({
  subscriptions,
  remainingPages,
  /**
   * Account's plan tier — used so the "budget reached" message can point
   * Free Forever users to Starter specifically (not the generic "wait until
   * next month" copy which is misleading for the activation path).
   */
  planTier,
  label = "Upload contracts",
  variant = "default",
  icon,
}: {
  subscriptions: SubscriptionOption[];
  remainingPages: number;
  planTier?: string;
  label?: string;
  variant?: "default" | "outline";
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [subscriptionId, setSubscriptionId] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  const totals = useMemo(() => {
    const succeeded = entries.filter((e) => e.status === "succeeded").length;
    const failed = entries.filter((e) => e.status === "failed").length;
    const pendingCount = entries.filter((e) => e.status === "pending").length;
    return { succeeded, failed, pendingCount };
  }, [entries]);

  function addFiles(picked: FileList | null | undefined) {
    if (!picked) return;
    const added: FileEntry[] = [];
    for (const f of Array.from(picked)) {
      const ext = f.name.split(".").pop()?.toLowerCase();
      if (!ext || !ALLOWED_EXT.includes(ext)) {
        added.push({
          key: makeKey(f),
          file: f,
          status: "failed",
          error: `Unsupported file type .${ext}`,
        });
        continue;
      }
      if (f.size > MAX_BYTES) {
        added.push({
          key: makeKey(f),
          file: f,
          status: "failed",
          error: `Too large (${(f.size / 1024 / 1024).toFixed(1)} MB; max 20 MB)`,
        });
        continue;
      }
      added.push({ key: makeKey(f), file: f, status: "pending" });
    }
    setEntries((prev) => [...prev, ...added]);
    setFormError(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files);
    // Reset the input so re-selecting the same file fires `change` again.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeEntry(key: string) {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }

  async function handleUpload() {
    const pendingEntries = entries.filter((e) => e.status === "pending");
    if (pendingEntries.length === 0) return;

    setFormError(null);
    startTransition(async () => {
      // Mark all pending entries as in-flight up front so the user sees the
      // whole batch progress, not a "one at a time" rolling animation.
      setEntries((prev) =>
        prev.map((e) =>
          e.status === "pending" ? { ...e, status: "uploading" as const } : e
        )
      );

      const successes: string[] = [];

      // Chunk into batches matching the server's MAX_FILES_PER_REQUEST.
      for (let i = 0; i < pendingEntries.length; i += FILES_PER_REQUEST) {
        const chunk = pendingEntries.slice(i, i + FILES_PER_REQUEST);
        try {
          const form = new FormData();
          for (const entry of chunk) {
            form.append("files", entry.file);
          }
          if (subscriptionId && subscriptionId !== "__none__") {
            form.append("subscriptionId", subscriptionId);
          }

          const res = await fetch("/api/documents/upload", {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as UploadResponse;

          if (!data.ok) {
            // Whole-batch failure (e.g. RBAC, 400). Mark all chunk entries
            // as failed with the message; loop continues to the next chunk.
            const message = data.error ?? "Upload failed";
            setEntries((prev) =>
              prev.map((e) =>
                chunk.some((c) => c.key === e.key)
                  ? { ...e, status: "failed" as const, error: message }
                  : e
              )
            );
            continue;
          }

          // Map results back to chunk entries by filename. The server
          // preserves order, but filename matching is more robust to
          // future reorderings (and to repeated names across batches).
          const resultsByName = new Map<string, UploadResultEntry>();
          for (const r of data.results) resultsByName.set(r.filename, r);

          setEntries((prev) =>
            prev.map((e) => {
              if (!chunk.some((c) => c.key === e.key)) return e;
              const r = resultsByName.get(e.file.name);
              if (!r) {
                return {
                  ...e,
                  status: "failed",
                  error: "Server didn't return a result for this file",
                };
              }
              if (r.ok) {
                if (!r.alreadyExisted) {
                  successes.push(r.documentId);
                }
                return {
                  ...e,
                  status: r.alreadyExisted ? "duplicate" : "succeeded",
                  originalUploadedAt: r.originalUploadedAt,
                };
              }
              return { ...e, status: "failed", error: r.error };
            })
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Network error";
          setEntries((prev) =>
            prev.map((e) =>
              chunk.some((c) => c.key === e.key)
                ? { ...e, status: "failed" as const, error: message }
                : e
            )
          );
        }
      }

      if (successes.length > 0) {
        toast({
          title: `${successes.length} contract${successes.length === 1 ? "" : "s"} uploaded`,
          description:
            "Extraction is running. Check the documents list for status.",
        });
        router.refresh();
      }
    });
  }

  const noBudget = Number.isFinite(remainingPages) && remainingPages <= 0;
  const allDone =
    entries.length > 0 && entries.every((e) => e.status !== "pending");
  const canSubmit =
    entries.some((e) => e.status === "pending") && !pending && !noBudget;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setFormError(null);
          setEntries([]);
          setSubscriptionId("");
        }
      }}
    >
      <Button
        type="button"
        variant={variant}
        onClick={() => setOpen(true)}
        disabled={noBudget}
        title={noBudget ? "Monthly extraction budget reached" : undefined}
      >
        {icon ?? <Upload className="mr-2 h-4 w-4" />}
        {label}
      </Button>

      <DialogContent
        className="max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Upload contracts</DialogTitle>
          <DialogDescription>
            Select one or many. PDF, DOCX, XLSX, CSV, or plain text. Up to
            20 MB per file. We extract the renewal date, notice period,
            auto-renew status, contract value, price-increase clause, and
            cancellation method — each field comes with the verbatim source
            quote and page number, ready for your review.
          </DialogDescription>
        </DialogHeader>

        {noBudget ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {planTier === "free_forever"
                ? "You've used the 5 free pages on your plan. Upgrade to Starter for 200 pages/mo and a higher limit."
                : "You've used your monthly extraction budget. Upgrade your plan or wait until next month."}
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="document-file">Files</Label>
              <input
                ref={fileInputRef}
                id="document-file"
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/plain,text/csv,text/markdown,text/x-markdown,text/html"
                onChange={handleFileChange}
                disabled={pending}
                className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
              />
              <p className="text-xs text-muted-foreground mt-1">
                You can pick multiple files at once. A 50-contract folder will
                be split into batches of {FILES_PER_REQUEST} automatically.
              </p>
            </div>

            {entries.length > 0 && (
              <FileList entries={entries} onRemove={removeEntry} />
            )}

            {subscriptions.length > 0 && (
              <div>
                <Label htmlFor="link-subscription">
                  Link to subscription (optional)
                </Label>
                <Select
                  value={subscriptionId || "__none__"}
                  onValueChange={setSubscriptionId}
                  disabled={pending}
                >
                  <SelectTrigger id="link-subscription" className="mt-1.5">
                    <SelectValue placeholder="Don't link" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Don't link</SelectItem>
                    {subscriptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Applies to every file in this batch. Linked subscriptions
                  get their fields updated when you approve extractions in the
                  review queue.
                </p>
              </div>
            )}

            {formError && <div className="text-xs text-red-700">{formError}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {allDone ? "Done" : "Cancel"}
              </Button>
              <Button onClick={handleUpload} disabled={!canSubmit}>
                {pending
                  ? "Uploading…"
                  : totals.pendingCount > 0
                    ? `Upload ${totals.pendingCount} file${totals.pendingCount === 1 ? "" : "s"}`
                    : "Upload"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileList({
  entries,
  onRemove,
}: {
  entries: FileEntry[];
  onRemove: (key: string) => void;
}) {
  return (
    <ul className="space-y-1.5 max-h-[280px] overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm">
      {entries.map((e) => (
        <li
          key={e.key}
          className="flex items-center gap-2 rounded-md bg-background border px-2 py-1.5"
        >
          <StatusIcon status={e.status} />
          <span className="truncate flex-1 text-xs font-medium">
            {e.file.name}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {(e.file.size / 1024).toFixed(0)} KB
          </span>
          {e.status === "duplicate" && e.originalUploadedAt && (
            <span
              className="text-[11px] text-amber-700 truncate"
              title={`Originally uploaded ${new Date(e.originalUploadedAt).toLocaleString()}`}
            >
              Already on file — {formatDuplicateDate(e.originalUploadedAt)}
            </span>
          )}
          {e.status === "failed" && e.error && (
            <span className="text-[11px] text-red-700 truncate max-w-[200px]">
              {e.error}
            </span>
          )}
          {(e.status === "pending" || e.status === "failed") && (
            <button
              type="button"
              onClick={() => onRemove(e.key)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label={`Remove ${e.file.name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function StatusIcon({ status }: { status: FileEntry["status"] }) {
  if (status === "succeeded")
    return <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />;
  if (status === "duplicate")
    return <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />;
  if (status === "failed")
    return <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />;
  if (status === "uploading")
    return (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
    );
  return (
    <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 shrink-0" />
  );
}

function formatDuplicateDate(iso: string): string {
  // Short relative-ish format. Today, yesterday, or "MMM d, yyyy".
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  const today = new Date();
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate();
  if (sameDay) return "today";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function makeKey(file: File): string {
  // Filename + size + lastModified is unique enough for client-side keying
  // within a single dialog session and avoids re-keys when status changes.
  return `${file.name}::${file.size}::${file.lastModified}`;
}
