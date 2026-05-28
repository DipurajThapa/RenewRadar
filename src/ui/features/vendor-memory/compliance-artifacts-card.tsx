"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, ShieldCheck, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { Input } from "@ui/components/primitives/input";
import { Label } from "@ui/components/primitives/label";
import { Badge } from "@ui/components/primitives/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/primitives/select";
import { useToast } from "@ui/hooks/use-toast";
import {
  recordComplianceArtifactAction,
  removeComplianceArtifactAction,
} from "@app/(app)/vendors/actions";
import type { ComplianceArtifact } from "@server/infrastructure/db/schema";
import { COMPLIANCE_ARTIFACT_LABEL } from "@server/domain/vendor-memory/event-labels";

const KINDS: Array<{ value: string; label: string }> = Object.entries(
  COMPLIANCE_ARTIFACT_LABEL
).map(([value, label]) => ({ value, label }));

export function ComplianceArtifactsCard({
  vendorId,
  artifacts,
}: {
  vendorId: string;
  artifacts: ComplianceArtifact[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Compliance documents on file</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Record-keeping only — not a legal review. Have counsel inspect
            the documents themselves.
          </p>
        </div>
        <Button
          size="sm"
          variant={adding ? "outline" : "default"}
          onClick={() => setAdding(!adding)}
        >
          {adding ? (
            <>
              <X className="mr-1 h-3 w-3" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="mr-1 h-3 w-3" />
              Record document
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && <AddArtifactForm vendorId={vendorId} onDone={() => setAdding(false)} />}
        {artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None recorded. Adding a DPA, SOC 2 report, or similar makes it
            searchable here forever.
          </p>
        ) : (
          <ul className="divide-y">
            {artifacts.map((a) => {
              const expiringSoon =
                a.expiresAt && a.expiresAt.getTime() - Date.now() < 60 * 86_400_000;
              const expired =
                a.expiresAt && a.expiresAt.getTime() < Date.now();
              return (
                <li
                  key={a.id}
                  className="py-2.5 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {COMPLIANCE_ARTIFACT_LABEL[a.kind] ?? a.kind}
                      </span>
                      {expired ? (
                        <Badge variant="outline" className="bg-red-50 text-red-900 border-red-200">
                          <AlertCircle className="mr-1 h-3 w-3" />
                          Expired
                        </Badge>
                      ) : expiringSoon ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-200">
                          Expiring soon
                        </Badge>
                      ) : a.receivedAt ? (
                        <Badge variant="outline" className="bg-green-50 text-green-900 border-green-200">
                          <ShieldCheck className="mr-1 h-3 w-3" />
                          On file
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {a.receivedAt && (
                        <>
                          Received {a.receivedAt.toISOString().split("T")[0]}
                        </>
                      )}
                      {a.expiresAt && (
                        <>
                          {" · "}Expires {a.expiresAt.toISOString().split("T")[0]}
                        </>
                      )}
                    </div>
                    {a.note && (
                      <div className="text-xs text-muted-foreground italic mt-1">
                        {a.note}
                      </div>
                    )}
                  </div>
                  <RemoveArtifactButton artifactId={a.id} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AddArtifactForm({
  vendorId,
  onDone,
}: {
  vendorId: string;
  onDone: () => void;
}) {
  const [kind, setKind] = useState("dpa");
  const [receivedAt, setReceivedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleSave() {
    startTransition(async () => {
      const r = await recordComplianceArtifactAction({
        vendorId,
        kind,
        receivedAt: receivedAt || null,
        expiresAt: expiresAt || null,
        note: note || null,
      });
      if (r.ok) {
        toast({ title: "Recorded" });
        onDone();
        router.refresh();
      } else {
        toast({ title: "Couldn't record", description: r.error });
      }
    });
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="receivedAt">Received</Label>
          <Input
            id="receivedAt"
            type="date"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="expiresAt">Expires (optional)</Label>
          <Input
            id="expiresAt"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="note">Note (optional)</Label>
          <Input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Version, signatory, scope…"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function RemoveArtifactButton({ artifactId }: { artifactId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleRemove() {
    if (!window.confirm("Remove this record? The underlying document file (if any) stays on the contracts page.")) return;
    startTransition(async () => {
      const r = await removeComplianceArtifactAction(artifactId);
      if (r.ok) {
        toast({ title: "Removed" });
        router.refresh();
      } else {
        toast({ title: "Couldn't remove", description: r.error });
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleRemove}
      disabled={pending}
      className="text-muted-foreground hover:text-red-700 shrink-0"
    >
      <X className="h-3 w-3" />
      <span className="sr-only">Remove</span>
    </Button>
  );
}
