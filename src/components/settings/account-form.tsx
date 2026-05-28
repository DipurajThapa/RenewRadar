"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useState } from "react";
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
import {
  updateAccountAction,
  type UpdateAccountResult,
} from "@/app/(app)/settings/account/actions";
import { COMMON_TIMEZONES } from "@/lib/validation/account";

export function AccountForm({
  accountName,
  billingEmail,
  timezone,
}: {
  accountName: string;
  billingEmail: string;
  timezone: string;
}) {
  const [state, action] = useFormState(
    updateAccountAction,
    undefined as UpdateAccountResult | undefined
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (state?.ok) {
      setSavedAt(Date.now());
      const timer = setTimeout(() => setSavedAt(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const formError = state && !state.ok ? state.formError : undefined;

  return (
    <form action={action} className="space-y-4">
      {formError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {formError}
        </div>
      )}

      <Field
        label="Account name"
        name="name"
        error={fieldErrors.name}
      >
        <Input
          id="name"
          name="name"
          defaultValue={accountName}
          required
          className="max-w-md"
        />
      </Field>

      <Field
        label="Billing email"
        name="billingEmail"
        hint="Stripe receipts and Renewal Radar billing notifications go here."
        error={fieldErrors.billingEmail}
      >
        <Input
          id="billingEmail"
          name="billingEmail"
          type="email"
          defaultValue={billingEmail}
          required
          className="max-w-md"
        />
      </Field>

      <Field
        label="Time zone"
        name="timezone"
        hint="Affects when daily emails are scheduled and how dates display."
        error={fieldErrors.timezone}
      >
        <Select name="timezone" defaultValue={timezone}>
          <SelectTrigger className="max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMMON_TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <SaveButton />
        {savedAt && (
          <span className="text-sm text-green-700">Saved</span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  error,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string[];
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && !error && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
      {error && error.length > 0 && (
        <p className="mt-1 text-xs text-red-600">{error.join(" · ")}</p>
      )}
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save changes"}
    </Button>
  );
}
