import Link from "next/link";
import { FileText, AlertTriangle } from "lucide-react";
import { Badge } from "@ui/components/primitives/badge";
import { formatDate } from "@shared/utils";
import { DocumentActions } from "./document-actions";
import type { DocumentRow } from "@server/infrastructure/db/repositories/documents";

const STATUS_VARIANT: Record<
  string,
  { label: string; tone: "muted" | "info" | "success" | "warning" | "danger" }
> = {
  pending: { label: "Queued", tone: "muted" },
  extracting: { label: "Extracting…", tone: "info" },
  ready: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function DocumentList({ documents }: { documents: DocumentRow[] }) {
  return (
    <div className="rounded-lg border bg-white">
      <div className="hidden md:grid md:grid-cols-[2fr_1.5fr_1fr_0.8fr_auto] gap-3 px-4 py-3 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/30">
        <div>Contract</div>
        <div>Subscription</div>
        <div>Status</div>
        <div>Uploaded</div>
        <div />
      </div>
      <ul className="divide-y">
        {documents.map((doc) => {
          const status = STATUS_VARIANT[doc.textExtractionStatus] ?? STATUS_VARIANT.pending!;
          return (
            <li
              key={doc.id}
              className="grid grid-cols-1 md:grid-cols-[2fr_1.5fr_1fr_0.8fr_auto] gap-3 px-4 py-3 items-center text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{doc.filename}</div>
                  <div className="text-xs text-muted-foreground">
                    {(doc.sizeBytes / 1024).toFixed(0)} KB
                    {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
                    {doc.pendingFieldCount > 0 && (
                      <>
                        {" · "}
                        <Link
                          href="/review-queue"
                          className="text-amber-700 hover:underline"
                        >
                          {doc.pendingFieldCount} field
                          {doc.pendingFieldCount === 1 ? "" : "s"} to review
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-w-0 text-sm">
                {doc.vendorName && doc.productName ? (
                  <Link
                    href={`/subscriptions/${doc.subscriptionId}`}
                    className="hover:underline"
                  >
                    {doc.vendorName} — {doc.productName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground italic">
                    Unlinked
                  </span>
                )}
              </div>

              <div>
                <StatusBadge label={status.label} tone={status.tone} />
                {doc.textExtractionStatus === "failed" &&
                  doc.textExtractionError && (
                    <div className="text-xs text-red-700 mt-1 inline-flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5" />
                      <span className="truncate" title={doc.textExtractionError}>
                        {doc.textExtractionError}
                      </span>
                    </div>
                  )}
              </div>

              <div className="text-xs text-muted-foreground tabular-nums">
                {formatDate(doc.uploadedAt)}
              </div>

              <DocumentActions
                documentId={doc.id}
                canRetrigger={
                  doc.textExtractionStatus === "failed" ||
                  doc.textExtractionStatus === "ready"
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "muted" | "info" | "success" | "warning" | "danger";
}) {
  const className =
    tone === "success"
      ? "bg-green-50 text-green-900 border-green-200"
      : tone === "info"
        ? "bg-blue-50 text-blue-900 border-blue-200"
        : tone === "warning"
          ? "bg-amber-50 text-amber-900 border-amber-200"
          : tone === "danger"
            ? "bg-red-50 text-red-900 border-red-200"
            : "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <Badge variant="outline" className={`${className} font-medium`}>
      {label}
    </Badge>
  );
}

// Badge typings allow only "default"/"secondary"/"destructive"/"outline" out
// of the box; outline + custom Tailwind class gives us the four tones we
// need without forking the primitive.
