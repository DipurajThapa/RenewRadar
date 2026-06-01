/**
 * The unified "Needs you" queue (P2-S5 / AI5). Converges the four separate
 * workflow inboxes — review-queue, approvals, requests, spend — plus the
 * renewal action-queue into ONE ranked list, so the operator sees a single
 * prioritised "what needs me" instead of five tabs. Pure convergence: it reuses
 * the existing per-source listers and the shared ranker; it stores nothing and
 * the four source pages stay reachable as the native action surfaces.
 */
import {
  listActionQueueRows,
} from "@server/infrastructure/db/repositories/action-queue";
import { listPendingReviewFields } from "@server/infrastructure/db/repositories/ai-extractions";
import { listPendingApprovals } from "@server/infrastructure/db/repositories/approvals";
import { listDetectedRecurringCharges } from "@server/infrastructure/db/repositories/spend";
import { listIntakeRequests } from "@server/application/intake-requests";
import { urgencyScore, type NeedsYouType } from "@server/domain/needs-you/rank";

export type NeedsYouItem = {
  type: NeedsYouType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  urgencyScore: number;
  valueCents: number | null;
  deadline: string | null;
};

export type NeedsYouQueue = {
  items: NeedsYouItem[];
  countsByType: Record<NeedsYouType, number>;
};

function todayUtcMs(): number {
  const t = new Date();
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

export async function buildNeedsYouQueue(
  accountId: string
): Promise<NeedsYouQueue> {
  const [renewals, reviews, approvals, requests, spend] = await Promise.all([
    listActionQueueRows(accountId),
    listPendingReviewFields(accountId),
    listPendingApprovals(accountId),
    listIntakeRequests(accountId, { status: "pending" }),
    listDetectedRecurringCharges(accountId),
  ]);

  const today = todayUtcMs();
  const now = Date.now();
  const daysUntil = (iso: string) =>
    Math.round(
      (new Date(`${iso}T00:00:00Z`).getTime() - today) / 86_400_000
    );
  const ageDays = (d: Date) =>
    Math.max(0, Math.floor((now - d.getTime()) / 86_400_000));

  const items: NeedsYouItem[] = [];

  for (const r of renewals) {
    items.push({
      type: "renewal",
      id: `renewal:${r.renewalEventId}`,
      title: `${r.vendorName} — ${r.productName}`,
      subtitle: `Notice deadline ${r.noticeDeadline} · ${r.daysUntilNoticeDeadline}d left`,
      href: `/subscriptions/${r.subscriptionId}/decide?event=${r.renewalEventId}`,
      urgencyScore: urgencyScore({
        daysUntilDeadline: r.daysUntilNoticeDeadline,
        intrinsic: r.risk.score,
      }),
      valueCents: r.annualValueCents,
      deadline: r.noticeDeadline,
    });
  }

  for (const f of reviews) {
    const label = f.vendorName
      ? `${f.vendorName}${f.productName ? ` — ${f.productName}` : ""}`
      : f.documentFilename;
    items.push({
      type: "review",
      id: `review:${f.id}`,
      title: label,
      subtitle: `Extracted "${f.fieldKey.replace(/_/g, " ")}" awaiting your review`,
      href: "/review-queue",
      urgencyScore: urgencyScore({ ageDays: ageDays(f.createdAt), intrinsic: 20 }),
      valueCents: null,
      deadline: null,
    });
  }

  for (const a of approvals) {
    items.push({
      type: "approval",
      id: `approval:${a.renewalEventId}`,
      title: `${a.vendorName} — ${a.productName}`,
      subtitle: `Decision "${a.decision.replace(/_/g, " ")}" awaiting approval`,
      href: "/approvals",
      urgencyScore: urgencyScore({
        daysUntilDeadline: daysUntil(a.noticeDeadline),
        intrinsic: 40,
      }),
      valueCents: a.annualValueCents,
      deadline: a.noticeDeadline,
    });
  }

  for (const q of requests) {
    items.push({
      type: "request",
      id: `request:${q.id}`,
      title: `${q.vendor} — ${q.product}`,
      subtitle: "Procurement request awaiting review",
      href: `/requests/${q.id}`,
      urgencyScore: urgencyScore(
        q.expectedStartDate
          ? { daysUntilDeadline: daysUntil(q.expectedStartDate), intrinsic: 25 }
          : { ageDays: ageDays(q.createdAt), intrinsic: 25 }
      ),
      valueCents: q.estimatedAnnualUsdCents,
      deadline: q.expectedStartDate ?? null,
    });
  }

  for (const c of spend) {
    const name = c.suggestedVendorName ?? c.normalizedMerchant;
    items.push({
      type: "spend",
      id: `spend:${c.id}`,
      title: name,
      subtitle: `Detected recurring charge · ${c.confidence}% match`,
      href: "/spend",
      urgencyScore: urgencyScore(
        c.projectedNextChargeOn
          ? {
              daysUntilDeadline: daysUntil(c.projectedNextChargeOn),
              intrinsic: c.confidence,
            }
          : { intrinsic: c.confidence }
      ),
      valueCents: c.typicalAmountCents,
      deadline: c.projectedNextChargeOn ?? null,
    });
  }

  // Highest urgency first; ties broken by dollar value at stake.
  items.sort(
    (a, b) =>
      b.urgencyScore - a.urgencyScore ||
      (b.valueCents ?? 0) - (a.valueCents ?? 0)
  );

  const countsByType: Record<NeedsYouType, number> = {
    renewal: renewals.length,
    review: reviews.length,
    approval: approvals.length,
    request: requests.length,
    spend: spend.length,
  };

  return { items, countsByType };
}
