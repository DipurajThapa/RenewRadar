"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileQuestion, Link2 } from "lucide-react";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/primitives/select";
import { useToast } from "@ui/hooks/use-toast";
import { linkDocumentToSubscriptionAction } from "@app/(app)/review-queue/actions";

type SubscriptionOption = { id: string; label: string };

type UnlinkedDocument = {
  documentId: string;
  filename: string;
  fieldCount: number;
};

/**
 * Surfaces every document in the review queue whose fields can't be
 * applied yet because the contract isn't attached to a subscription.
 *
 * Before this banner existed, the upload-without-link path created an
 * orphan field set: extracted, evidence captured, but unappliable. Accept
 * threw at the application layer with no recovery affordance. Now the
 * user picks the matching subscription and the link cascades.
 *
 * Sits at the top of the review queue so it's the first thing the user
 * deals with — once the doc is linked, the underlying fields fall into the
 * normal grouped review list below.
 */
export function UnlinkedDocumentsBanner({
  documents,
  subscriptions,
}: {
  documents: UnlinkedDocument[];
  subscriptions: SubscriptionOption[];
}) {
  if (documents.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardContent className="py-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-amber-100 text-amber-900 shrink-0">
            <FileQuestion className="h-4 w-4" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="font-semibold text-amber-950">
              {documents.length} contract{documents.length === 1 ? "" : "s"}{" "}
              {documents.length === 1 ? "needs" : "need"} to be linked to a
              subscription
            </div>
            <p className="text-sm text-amber-900 leading-relaxed">
              These contracts were uploaded without a subscription pick.
              Choose which subscription each one belongs to so the extracted
              fields can be applied. Or{" "}
              <a
                href="/subscriptions/new"
                className="underline hover:no-underline"
              >
                add a new subscription
              </a>{" "}
              first and come back.
            </p>
          </div>
        </div>
        <ul className="space-y-2">
          {documents.map((doc) => (
            <UnlinkedRow
              key={doc.documentId}
              doc={doc}
              subscriptions={subscriptions}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function UnlinkedRow({
  doc,
  subscriptions,
}: {
  doc: UnlinkedDocument;
  subscriptions: SubscriptionOption[];
}) {
  const [selected, setSelected] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleLink() {
    if (!selected) {
      toast({
        title: "Pick a subscription first",
        description: "Or add a new one before linking.",
      });
      return;
    }
    startTransition(async () => {
      const r = await linkDocumentToSubscriptionAction(doc.documentId, selected);
      if (r.ok) {
        toast({
          title: "Contract linked",
          description: `Fields are now ready to review.`,
        });
        router.refresh();
      } else {
        toast({ title: "Couldn't link", description: r.error });
      }
    });
  }

  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-md border border-amber-200 bg-background p-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{doc.filename}</div>
        <div className="text-xs text-muted-foreground">
          {doc.fieldCount} extracted field
          {doc.fieldCount === 1 ? "" : "s"} waiting
        </div>
      </div>
      {subscriptions.length === 0 ? (
        <span className="text-xs text-amber-800 italic">
          Add a subscription first ↑
        </span>
      ) : (
        <>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="sm:w-64">
              <SelectValue placeholder="Pick a subscription" />
            </SelectTrigger>
            <SelectContent>
              {subscriptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleLink}
            disabled={pending || !selected}
          >
            <Link2 className="mr-1 h-4 w-4" />
            {pending ? "Linking…" : "Link"}
          </Button>
        </>
      )}
    </li>
  );
}
