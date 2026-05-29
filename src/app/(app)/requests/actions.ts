"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  approveIntakeRequest,
  denyIntakeRequest,
  IntakeRequestError,
  markIntakeRequestDuplicate,
  submitIntakeRequest,
  withdrawIntakeRequest,
} from "@server/application/intake-requests";
import {
  notifyIntakeDecision,
  notifyIntakeSubmitted,
} from "@server/application/intake-requests/notifications";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "requests.actions" });

/**
 * Run a notification dispatch without ever letting it break the user-facing
 * action. The mutation has already committed + audit-logged by this point;
 * a failed email is a soft failure we log and move past. We `await` (rather
 * than fire-and-forget) so the send actually completes before the
 * serverless function returns — unawaited promises get killed.
 */
async function safeNotify(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.warn("intake_notify_failed", {
      label,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export type SubmitResult =
  | { ok: true; requestId: string }
  | { ok: false; formError: string };

/**
 * Any authenticated member can submit a request — that's the whole point
 * of the intake form. We still require *some* role (i.e. user is logged
 * in) via the `requireRole(user, "member")` floor.
 */
export async function submitRequestAction(input: {
  vendor: string;
  product: string;
  planNotes?: string | null;
  businessCase: string;
  estimatedAnnualUsdDollars: number;
  expectedStartDate?: string | null;
}): Promise<SubmitResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, formError: err.message };
    throw err;
  }
  try {
    const row = await submitIntakeRequest({
      accountId: account.id,
      requesterUserId: user.id,
      vendor: input.vendor,
      product: input.product,
      planNotes: input.planNotes ?? null,
      businessCase: input.businessCase,
      estimatedAnnualUsdCents: Math.round(
        (Number(input.estimatedAnnualUsdDollars) || 0) * 100
      ),
      expectedStartDate: input.expectedStartDate ?? null,
    });
    await safeNotify("submitted", () =>
      notifyIntakeSubmitted({ request: row, requesterName: user.fullName })
    );
    revalidatePath("/requests");
    return { ok: true, requestId: row.id };
  } catch (err) {
    if (err instanceof IntakeRequestError) return { ok: false, formError: err.message };
    throw err;
  }
}

export type ReviewResult = { ok: boolean; error?: string };

export async function approveRequestAction(input: {
  requestId: string;
  reviewerNote?: string | null;
}): Promise<ReviewResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    const { request } = await approveIntakeRequest({
      accountId: account.id,
      requestId: input.requestId,
      reviewerUserId: user.id,
      reviewerNote: input.reviewerNote ?? null,
    });
    await safeNotify("approved", () =>
      notifyIntakeDecision({ request, decision: "approved" })
    );
    revalidatePath("/requests");
    revalidatePath(`/requests/${input.requestId}`);
    revalidatePath("/subscriptions");
    return { ok: true };
  } catch (err) {
    if (err instanceof IntakeRequestError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function denyRequestAction(input: {
  requestId: string;
  reviewerNote: string;
}): Promise<ReviewResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    const request = await denyIntakeRequest({
      accountId: account.id,
      requestId: input.requestId,
      reviewerUserId: user.id,
      reviewerNote: input.reviewerNote,
    });
    await safeNotify("denied", () =>
      notifyIntakeDecision({ request, decision: "denied" })
    );
    revalidatePath("/requests");
    revalidatePath(`/requests/${input.requestId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof IntakeRequestError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function markDuplicateRequestAction(input: {
  requestId: string;
  linkedSubscriptionId: string;
  reviewerNote?: string | null;
}): Promise<ReviewResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    const request = await markIntakeRequestDuplicate({
      accountId: account.id,
      requestId: input.requestId,
      reviewerUserId: user.id,
      linkedSubscriptionId: input.linkedSubscriptionId,
      reviewerNote: input.reviewerNote ?? null,
    });
    await safeNotify("duplicate", () =>
      notifyIntakeDecision({ request, decision: "duplicate" })
    );
    revalidatePath("/requests");
    revalidatePath(`/requests/${input.requestId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof IntakeRequestError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function withdrawRequestAction(
  requestId: string
): Promise<ReviewResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    await withdrawIntakeRequest({
      accountId: account.id,
      requestId,
      requesterUserId: user.id,
    });
    revalidatePath("/requests");
    revalidatePath(`/requests/${requestId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof IntakeRequestError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Server-action wrapper for the submit form. Used by Next's form actions
 * (`<form action={submitRequestFormAction}>`). On success, redirects to the
 * request list.
 */
export async function submitRequestFormAction(formData: FormData) {
  const r = await submitRequestAction({
    vendor: String(formData.get("vendor") ?? ""),
    product: String(formData.get("product") ?? ""),
    planNotes: (formData.get("planNotes")?.toString() || null) ?? null,
    businessCase: String(formData.get("businessCase") ?? ""),
    estimatedAnnualUsdDollars: Number(
      formData.get("estimatedAnnualUsdDollars") ?? 0
    ),
    expectedStartDate:
      formData.get("expectedStartDate")?.toString() || null,
  });
  if (!r.ok) {
    redirect(`/requests/new?error=${encodeURIComponent(r.formError)}`);
  }
  redirect("/requests");
}
