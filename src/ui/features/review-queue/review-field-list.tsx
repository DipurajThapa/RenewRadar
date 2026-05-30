import { ReviewFieldRow } from "./review-field-row";
import type { PendingReviewField } from "@server/infrastructure/db/repositories/ai-extractions";
import { extractableFieldsNotPresent } from "@server/domain/provenance/missing-info";

/**
 * Group pending fields by document so the user sees "Atlassian Contract.pdf
 * — 6 fields" as one card and reviews them together. Easier than scanning
 * a flat list of 60 fields across 10 contracts.
 */
type DocumentGroup = {
  documentId: string;
  documentFilename: string;
  vendorName: string | null;
  productName: string | null;
  fields: PendingReviewField[];
};

export function ReviewFieldList({ fields }: { fields: PendingReviewField[] }) {
  const byDoc = new Map<string, DocumentGroup>();
  for (const field of fields) {
    const existing = byDoc.get(field.documentId);
    if (existing) {
      existing.fields.push(field);
    } else {
      byDoc.set(field.documentId, {
        documentId: field.documentId,
        documentFilename: field.documentFilename,
        vendorName: field.vendorName,
        productName: field.productName,
        fields: [field],
      });
    }
  }

  return (
    <div className="space-y-6">
      {Array.from(byDoc.values()).map((group) => {
        // Of the core extractable facts, which did this document NOT yield?
        // Pure derivation over the field keys present — no extra loading.
        const notFound = extractableFieldsNotPresent(
          group.fields.map((f) => f.fieldKey)
        );
        return (
          <section key={group.documentId} className="space-y-3">
            <header className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-semibold">{group.documentFilename}</h2>
              {group.vendorName && group.productName && (
                <span className="text-sm text-muted-foreground">
                  · {group.vendorName} — {group.productName}
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {group.fields.length} field{group.fields.length === 1 ? "" : "s"} to review
              </span>
            </header>
            <ul className="space-y-3">
              {group.fields.map((field) => (
                <li key={field.id}>
                  <ReviewFieldRow field={field} />
                </li>
              ))}
            </ul>
            {notFound.length > 0 && (
              <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  Missing information:
                </span>{" "}
                this document didn&apos;t yield{" "}
                {notFound.map((f) => f.label.toLowerCase()).join(", ")}. You may
                need to add {notFound.length === 1 ? "it" : "these"} manually.
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
