"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  sendInvitationAction,
  type InviteResult,
} from "@/app/(app)/settings/team/actions";

const initial: InviteResult | undefined = undefined;

export function InviteMemberForm() {
  const [state, formAction] = useFormState(sendInvitationAction, initial);
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      formRef.current?.reset();
      toast({
        title: "Invitation sent",
        description: "They'll get an email with a link to join.",
      });
    }
  }, [state, router, toast]);

  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const formError = state && !state.ok ? state.formError : undefined;

  return (
    <form ref={formRef} action={formAction} className="space-y-4 max-w-xl">
      {formError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {formError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
        <div>
          <Label htmlFor="invitee-email">Email</Label>
          <Input
            id="invitee-email"
            name="email"
            type="email"
            required
            placeholder="teammate@company.com"
            className="mt-1.5"
          />
          {fieldErrors.email && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.email.join(" · ")}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="invitee-role">Role</Label>
          <Select name="role" defaultValue="member">
            <SelectTrigger id="invitee-role" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          {fieldErrors.role && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.role.join(" · ")}
            </p>
          )}
        </div>
      </div>

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sending..." : "Send invitation"}
    </Button>
  );
}
