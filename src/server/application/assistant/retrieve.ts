/**
 * Deterministic retrieval dispatch for the grounded Ask assistant — the working
 * default (no keys, no vector DB). Maps a classified intent to the RIGHT already-
 * built aggregator/repo and flattens the result into `RetrievedFact`s, each with
 * a source ref + a deep-link. Lives in the APPLICATION layer because it composes
 * application aggregators (getAccountRiskSummary, buildNeedsYouQueue, …) — the
 * infrastructure `retriever` seam holds only the dormant vector scaffold.
 *
 * Read-only + account-scoped. Composes facts ONLY from the account's own data;
 * an intent with nothing to show returns `[]` and the reasoner answers honestly.
 */
import type { AskIntent } from "@server/domain/assistant/intent";
import type { RetrievedFact } from "@server/infrastructure/ai/reasoning/types";
import { getAccountRiskSummary } from "@server/application/account-risk";
import { buildNeedsYouQueue } from "@server/application/needs-you";
import { getVendorBenchmark } from "@server/application/vendor-benchmarks";
import {
  listVendorsByAccount,
} from "@server/infrastructure/db/repositories/vendors";
import { getVendorIntelligence } from "@server/infrastructure/db/repositories/vendor-memory";
import { listRenewalsInRange } from "@server/infrastructure/db/repositories/renewals";
import { getSavingsTotals } from "@server/infrastructure/db/repositories/savings";
import { listExpiringComplianceArtifacts } from "@server/infrastructure/db/repositories/compliance";
import { getDashboardKpis } from "@server/infrastructure/db/repositories/dashboard";
import { listSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import { formatCurrency } from "@shared/utils";

/** Annualize a per-period cost so cross-contract comparison is apples-to-apples. */
function annualizeCents(perPeriodCents: number, billingCycle: string): number {
  const c = billingCycle.toLowerCase();
  const mult = c.includes("month")
    ? 12
    : c.includes("quarter")
      ? 4
      : c.includes("week")
        ? 52
        : 1; // annual / yearly / unknown
  return perPeriodCents * mult;
}

function fact(
  source: string,
  detail: string,
  href: string | null,
  refId: string | null = null
): RetrievedFact {
  return { source, detail, quote: null, refId, href };
}

/** Resolve a vendor the question names, scoped to the account's own vendors.
 *  Longest name first so "Acme Insurance" beats "Acme". */
async function resolveVendor(accountId: string, question: string) {
  const vendors = await listVendorsByAccount(accountId);
  const q = question.toLowerCase();
  return (
    [...vendors]
      .sort((a, b) => b.name.length - a.name.length)
      .find((v) => q.includes(v.name.toLowerCase())) ?? null
  );
}

export async function retrieveFacts(
  accountId: string,
  intent: AskIntent,
  question: string
): Promise<RetrievedFact[]> {
  switch (intent) {
    case "account_risk": {
      const s = await getAccountRiskSummary(accountId);
      if (s.total === 0) return [];
      const out: RetrievedFact[] = [
        fact(
          "account_risk",
          `${s.highCount} high, ${s.mediumCount} medium, ${s.lowCount} low-risk renewals (${s.total} total).`,
          "/action-queue"
        ),
      ];
      if (s.topAtRisk) {
        out.push(
          fact(
            "account_risk",
            `Biggest risk: ${s.topAtRisk.vendorName} — ${s.topAtRisk.productName} (${formatCurrency(s.topAtRisk.annualValueCents)}/yr, ${s.topAtRisk.band} risk).`,
            `/subscriptions/${s.topAtRisk.subscriptionId}`,
            s.topAtRisk.subscriptionId
          )
        );
      }
      if (s.insight) {
        out.push(fact("account_risk", s.insight.headline, "/action-queue"));
      }
      return out;
    }

    case "needs_you": {
      const q = await buildNeedsYouQueue(accountId);
      if (q.items.length === 0) return [];
      const out: RetrievedFact[] = [
        fact(
          "needs_you",
          `${q.items.length} items need you — ${q.countsByType.renewal} renewals, ${q.countsByType.review} reviews, ${q.countsByType.approval} approvals, ${q.countsByType.request} requests, ${q.countsByType.spend} spend.`,
          "/action-queue"
        ),
      ];
      for (const item of q.items.slice(0, 3)) {
        out.push(fact("needs_you", `${item.title} — ${item.subtitle}`, item.href, item.id));
      }
      return out;
    }

    case "upcoming_renewals": {
      const rows = await listRenewalsInRange(accountId, 90);
      if (rows.length === 0) return [];
      return rows
        .slice(0, 8)
        .map((r) =>
          fact(
            "renewal_range",
            `${r.vendorName} — ${r.productName} renews ${r.renewalDate} (${formatCurrency(r.annualValueCents)}/yr).`,
            `/subscriptions/${r.subscriptionId}/decide?event=${r.renewalEventId}`,
            r.subscriptionId
          )
        );
    }

    case "vendor_spend": {
      const vendor = await resolveVendor(accountId, question);
      if (!vendor) return [];
      const vi = await getVendorIntelligence(accountId, vendor.id);
      const out: RetrievedFact[] = [
        fact(
          "vendor_intelligence",
          `${vendor.name}: ${formatCurrency(vi.totalSpendLifetimeCents)} lifetime spend across ${vi.subscriptionCount} subscription(s); ${formatCurrency(vi.totalSavingsLifetimeCents)} saved; ${vi.decisionCount} decision(s) logged.`,
          `/vendors/${vendor.id}`,
          vendor.id
        ),
      ];
      const last = vi.lastDecisions[0];
      if (last) {
        out.push(
          fact(
            "vendor_intelligence",
            `Last decision on ${last.productName}: ${last.decision.replace(/_/g, " ")}.`,
            `/vendors/${vendor.id}`,
            last.subscriptionId
          )
        );
      }
      return out;
    }

    case "vendor_benchmark": {
      const vendor = await resolveVendor(accountId, question);
      if (!vendor) return [];
      const b = await getVendorBenchmark(vendor.name);
      if (!b) {
        return [
          fact(
            "vendor_benchmark",
            `Not enough cross-account data yet to benchmark ${vendor.name}.`,
            `/vendors/${vendor.id}`,
            vendor.id
          ),
        ];
      }
      return [
        fact(
          "vendor_benchmark",
          `Typical for ${vendor.name} across ${b.sampleAccounts} accounts: notice ${b.typicalNoticePeriodDays ?? "—"} days, auto-renew ${b.autoRenewRatePct ?? "—"}%, median ${b.medianAnnualValueCents != null ? formatCurrency(b.medianAnnualValueCents) : "—"}/yr.`,
          `/vendors/${vendor.id}`,
          vendor.id
        ),
      ];
    }

    case "savings_summary": {
      const t = await getSavingsTotals(accountId);
      if (t.recordCount === 0) return [];
      return [
        fact(
          "savings",
          `Saved ${formatCurrency(t.totalSavedAnnualUsdCents)}/yr across ${t.recordCount} decision(s).`,
          "/reports"
        ),
      ];
    }

    case "expiring_compliance": {
      const rows = await listExpiringComplianceArtifacts(accountId, 60);
      if (rows.length === 0) return [];
      return rows
        .slice(0, 8)
        .map((r) =>
          fact(
            "compliance",
            `${r.kind} for ${r.vendorName} expires ${r.expiresAt ? r.expiresAt.toISOString().slice(0, 10) : "—"}.`,
            `/vendors/${r.vendorId}`,
            r.vendorId
          )
        );
    }

    case "kpis": {
      const k = await getDashboardKpis(accountId);
      return [
        fact(
          "kpis",
          `Tracking ${k.trackedSubscriptions} subscription(s), ${formatCurrency(k.totalAnnualSpendCents)}/yr total; ${k.noticeDeadlinesNext30Count} notice deadline(s) in the next 30 days; proven savings ${formatCurrency(k.provenSavedYtdAnnualUsdCents)}/yr YTD (${formatCurrency(k.savedYtdAnnualUsdCents)} projected).`,
          "/dashboard"
        ),
      ];
    }

    case "cross_document": {
      // Multi-document synthesis: one comparable fact PER subscription (each its
      // own contract), so a "which / compare / strictest" question has facts
      // spanning several documents for the reasoner to synthesize across.
      const subs = await listSubscriptions(accountId);
      if (subs.length === 0) return [];
      return subs.slice(0, 12).map((s) =>
        fact(
          "subscription",
          `${s.vendorName} — ${s.productName}: ${formatCurrency(annualizeCents(s.totalCostPerPeriodCents, s.billingCycle))}/yr, ` +
            `notice ${s.noticePeriodDays} days, ${s.autoRenew ? "auto-renews" : "no auto-renew"}, term ends ${s.termEndDate}.`,
          `/subscriptions/${s.id}`,
          s.id
        )
      );
    }

    case "unknown":
    default:
      return [];
  }
}
