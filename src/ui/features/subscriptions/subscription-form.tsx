"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@ui/components/primitives/button";
import { Input } from "@ui/components/primitives/input";
import { Label } from "@ui/components/primitives/label";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/primitives/select";
import {
  createSubscriptionAction,
  updateSubscriptionAction,
  type ActionResult,
} from "@app/(app)/subscriptions/actions";
import type { Subscription } from "@server/infrastructure/db/schema";
import type { AccountUserOption } from "@server/infrastructure/db/repositories/users";

type CommonProps = {
  /** Called on successful submit. Suppresses the default `router.push` to the detail page. */
  onSuccess?: (subscriptionId: string) => void;
  /** Called when the user clicks Cancel. Suppresses the default Link to /subscriptions or detail. */
  onCancel?: () => void;
  /** Owner options to show in the Owner select. Server-provided. */
  users: AccountUserOption[];
  /** Default owner for create mode — the current signed-in user. */
  currentUserId: string;
  /**
   * Existing vendor names on this account. Powers the vendor autocomplete
   * `<datalist>` so the user can pick "Atlassian" instead of typing
   * "atlassian " and creating a duplicate vendor row. Server-provided.
   */
  existingVendorNames?: string[];
};

type Props =
  | ({
      mode: "create";
      subscription?: undefined;
      vendorName?: undefined;
    } & CommonProps)
  | ({
      mode: "edit";
      subscription: Subscription;
      vendorName: string;
    } & CommonProps);

const initialState: ActionResult | undefined = undefined;

export function SubscriptionForm(props: Props) {
  const router = useRouter();

  const boundAction =
    props.mode === "create"
      ? createSubscriptionAction
      : updateSubscriptionAction.bind(null, props.subscription.id);

  const [state, formAction] = useFormState(boundAction, initialState);

  // Stash the callbacks in refs so the post-submit effect always sees the
  // latest values without re-firing when parent re-renders with new function
  // identities. This was a latent stale-closure risk under the prior
  // eslint-disable approach.
  const onSuccessRef = useRef(props.onSuccess);
  onSuccessRef.current = props.onSuccess;

  useEffect(() => {
    if (state?.ok) {
      const handler = onSuccessRef.current;
      if (handler) {
        handler(state.subscriptionId);
      } else {
        router.push(`/subscriptions/${state.subscriptionId}`);
      }
      router.refresh();
    }
  }, [state, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const formError = state && !state.ok ? state.formError : undefined;

  const defaults =
    props.mode === "edit"
      ? {
          vendorName: props.vendorName,
          productName: props.subscription.productName,
          planName: props.subscription.planName ?? "",
          billingCycle: props.subscription.billingCycle,
          termStartDate: props.subscription.termStartDate,
          termEndDate: props.subscription.termEndDate,
          autoRenew: props.subscription.autoRenew,
          noticePeriodDays: props.subscription.noticePeriodDays,
          totalSeats: props.subscription.totalSeats,
          unitPriceDollars: (props.subscription.unitPriceCents / 100).toFixed(2),
          notes: props.subscription.notes ?? "",
          ownerUserId: props.subscription.ownerUserId ?? "",
        }
      : {
          vendorName: "",
          productName: "",
          planName: "",
          billingCycle: "annual" as const,
          termStartDate: todayString(),
          termEndDate: oneYearFromTodayString(),
          autoRenew: true,
          noticePeriodDays: 30,
          totalSeats: 1,
          unitPriceDollars: "",
          notes: "",
          ownerUserId: props.currentUserId,
        };

  // Intercept submit to normalize the "__unassigned__" sentinel back to "".
  // Cheaper than maintaining controlled state for one field.
  const handleSubmit = (formData: FormData): void => {
    const v = formData.get("ownerUserId");
    if (typeof v === "string" && v === "__unassigned__") {
      formData.set("ownerUserId", "");
    }
    formAction(formData);
  };

  return (
    <form action={handleSubmit} className="space-y-6 max-w-2xl">
      {formError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {formError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Vendor and product</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Vendor"
            name="vendorName"
            hint="The company that bills you (e.g. Atlassian, Datadog, Figma). Existing vendors auto-suggest as you type."
            error={fieldErrors.vendorName}
          >
            <Input
              id="vendorName"
              name="vendorName"
              required
              defaultValue={defaults.vendorName}
              placeholder="e.g. Atlassian"
              readOnly={props.mode === "edit"}
              aria-readonly={props.mode === "edit"}
              // Autocomplete from existing vendors so the user doesn't
              // create "atlassian " or "Atlassian Inc" duplicates of
              // the same row. New names typed freely still work.
              list={
                props.mode === "create" && props.existingVendorNames
                  ? "subscription-vendor-options"
                  : undefined
              }
              autoComplete="off"
            />
            {props.mode === "create" &&
              props.existingVendorNames &&
              props.existingVendorNames.length > 0 && (
                <datalist id="subscription-vendor-options">
                  {props.existingVendorNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              )}
          </Field>

          <Field
            label="Product"
            name="productName"
            error={fieldErrors.productName}
          >
            <Input
              id="productName"
              name="productName"
              required
              defaultValue={defaults.productName}
              placeholder="e.g. Jira Software"
            />
          </Field>

          <Field
            label="Plan (optional)"
            name="planName"
            error={fieldErrors.planName}
          >
            <Input
              id="planName"
              name="planName"
              defaultValue={defaults.planName}
              placeholder="e.g. Standard"
            />
          </Field>

          <Field
            label="Owner"
            name="ownerUserId"
            hint="Who is accountable for the renewal decision on this subscription"
            error={fieldErrors.ownerUserId}
          >
            <Select
              name="ownerUserId"
              defaultValue={defaults.ownerUserId || "__unassigned__"}
            >
              <SelectTrigger id="ownerUserId">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassigned__">Unassigned</SelectItem>
                {props.users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.fullName ?? u.workEmail}
                    {u.fullName ? (
                      <span className="text-muted-foreground">
                        {" "}
                        — {u.workEmail}
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/*
              The Select stores "__unassigned__" as a sentinel because
              shadcn's Radix Select can't carry an empty string. We strip it
              back to empty before submit so the server sees null.
            */}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Billing cycle"
            name="billingCycle"
            error={fieldErrors.billingCycle}
          >
            <Select
              name="billingCycle"
              defaultValue={defaults.billingCycle}
            >
              <SelectTrigger id="billingCycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="multi_year">Multi-year</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Total seats"
              name="totalSeats"
              error={fieldErrors.totalSeats}
            >
              <Input
                id="totalSeats"
                name="totalSeats"
                type="number"
                min={1}
                step={1}
                required
                defaultValue={defaults.totalSeats}
              />
            </Field>

            <Field
              label="Unit price (USD)"
              name="unitPriceDollars"
              error={fieldErrors.unitPriceCents}
            >
              <Input
                id="unitPriceDollars"
                name="unitPriceDollars"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={defaults.unitPriceDollars}
                placeholder="0.00"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Term</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Term start"
              name="termStartDate"
              error={fieldErrors.termStartDate}
            >
              <Input
                id="termStartDate"
                name="termStartDate"
                type="date"
                required
                defaultValue={defaults.termStartDate}
              />
            </Field>

            <Field
              label="Term end"
              name="termEndDate"
              error={fieldErrors.termEndDate}
            >
              <Input
                id="termEndDate"
                name="termEndDate"
                type="date"
                required
                defaultValue={defaults.termEndDate}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Notice period (days)"
              name="noticePeriodDays"
              hint="How many days before term end you must give notice"
              error={fieldErrors.noticePeriodDays}
            >
              <Input
                id="noticePeriodDays"
                name="noticePeriodDays"
                type="number"
                min={0}
                max={365}
                step={1}
                defaultValue={defaults.noticePeriodDays}
              />
            </Field>

            <Field label="Auto-renew" name="autoRenew">
              <label className="flex items-center gap-2 h-10">
                <input
                  type="checkbox"
                  name="autoRenew"
                  defaultChecked={defaults.autoRenew}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm">Yes, this auto-renews</span>
              </label>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes (optional)</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            name="notes"
            rows={3}
            defaultValue={defaults.notes}
            placeholder="Anything you want to remember about this subscription"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </CardContent>
      </Card>

      <FormActions
        mode={props.mode}
        subscriptionId={props.subscription?.id}
        onCancel={props.onCancel}
      />
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

function FormActions({
  mode,
  subscriptionId,
  onCancel,
}: {
  mode: "create" | "edit";
  subscriptionId?: string;
  onCancel?: () => void;
}) {
  const { pending } = useFormStatus();
  const cancelHref =
    mode === "create" ? "/subscriptions" : `/subscriptions/${subscriptionId}`;
  return (
    <div className="flex justify-end gap-3">
      {onCancel ? (
        <Button
          variant="outline"
          type="button"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      ) : (
        <Button asChild variant="outline" type="button" disabled={pending}>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      )}
      <Button type="submit" disabled={pending}>
        {pending
          ? "Saving..."
          : mode === "create"
            ? "Add subscription"
            : "Save changes"}
      </Button>
    </div>
  );
}

function todayString(): string {
  return new Date().toISOString().split("T")[0]!;
}

function oneYearFromTodayString(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().split("T")[0]!;
}
