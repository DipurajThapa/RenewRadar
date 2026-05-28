"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, AlertCircle } from "lucide-react";
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

const ALLOWED_EXT = ["pdf", "docx", "txt"];
const MAX_BYTES = 20 * 1024 * 1024;

type SubscriptionOption = { id: string; label: string };

export function UploadDocumentButton({
  subscriptions,
  remainingPages,
  label = "Upload contract",
  variant = "default",
  icon,
}: {
  subscriptions: SubscriptionOption[];
  remainingPages: number;
  label?: string;
  variant?: "default" | "outline";
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXT.includes(ext)) {
      setError(`Unsupported file type .${ext}. Use PDF, DOCX, or TXT.`);
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB; max 20 MB)`);
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.append("file", file);
      if (subscriptionId && subscriptionId !== "__none__") {
        form.append("subscriptionId", subscriptionId);
      }
      try {
        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: form,
        });
        const data = (await res.json()) as {
          ok: boolean;
          error?: string;
        };
        if (!data.ok) {
          setError(data.error ?? "Upload failed");
          return;
        }
        toast({
          title: "Contract uploaded",
          description:
            "Extracting fields now. Check the documents list for status.",
        });
        setOpen(false);
        setFile(null);
        setSubscriptionId("");
        router.refresh();
      } catch (err) {
        console.error("[upload-button] fetch failed:", err);
        setError("Network error — try again");
      }
    });
  }

  const noBudget = Number.isFinite(remainingPages) && remainingPages <= 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setFile(null);
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
        className="max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Upload a contract</DialogTitle>
          <DialogDescription>
            PDF, DOCX, or plain text. Up to 20 MB. We extract the renewal
            date, notice period, auto-renew status, contract value, price
            increase clause, and cancellation method — every field comes
            with the verbatim source quote and page number.
          </DialogDescription>
        </DialogHeader>

        {noBudget ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              You've used your monthly extraction budget. Upgrade your plan
              or wait until next month.
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="document-file">File</Label>
              <input
                ref={fileInputRef}
                id="document-file"
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={handleFileChange}
                disabled={pending}
                className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
              />
              {file && (
                <div className="text-xs text-muted-foreground mt-1">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </div>
              )}
            </div>

            {subscriptions.length > 0 && (
              <div>
                <Label htmlFor="link-subscription">
                  Link to subscription (optional)
                </Label>
                <Select
                  value={subscriptionId || "__none__"}
                  onValueChange={setSubscriptionId}
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
                  Linked subscriptions get their fields updated when you
                  approve extractions in the review queue.
                </p>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-700">{error}</div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button onClick={handleUpload} disabled={pending || !file}>
                {pending ? "Uploading…" : "Upload + extract"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
