"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ui/components/primitives/dropdown-menu";
import { useToast } from "@ui/hooks/use-toast";
import {
  deleteDocumentAction,
  retriggerExtractionAction,
} from "@app/(app)/documents/actions";

export function DocumentActions({
  documentId,
  canRetrigger,
}: {
  documentId: string;
  canRetrigger: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleRetrigger() {
    setOpen(false);
    startTransition(async () => {
      const r = await retriggerExtractionAction(documentId);
      if (r.ok) {
        toast({
          title: "Extraction re-run",
          description: "Check the review queue for any new fields.",
        });
        router.refresh();
      } else {
        toast({ title: "Couldn't re-run", description: r.error });
      }
    });
  }

  function handleDelete() {
    if (
      !window.confirm(
        "Delete this contract? Extracted fields will be removed too."
      )
    ) {
      return;
    }
    setOpen(false);
    startTransition(async () => {
      const r = await deleteDocumentAction(documentId);
      if (r.ok) {
        toast({ title: "Contract deleted" });
        router.refresh();
      } else {
        toast({ title: "Couldn't delete", description: r.error });
      }
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canRetrigger && (
          <DropdownMenuItem onClick={handleRetrigger} disabled={pending}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Re-run extraction
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={handleDelete}
          disabled={pending}
          className="text-red-700"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
