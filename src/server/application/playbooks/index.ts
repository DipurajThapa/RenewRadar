/**
 * Decision playbook query — every savings-producing decision the team has
 * made, with the lever, rationale, vendor, and dollars saved. Surfaced on
 * the /playbooks page as institutional memory the next operator can reuse.
 *
 * The moat shape: this is the team's accumulated knowledge about which
 * negotiation tactics worked with which vendors at which sizes. A new
 * renewal owner can search "Atlassian + multi-year commit" and see what
 * worked last time. A Vendr / Tropic / Sastrify competitor without this
 * data is giving generic advice.
 *
 * Tenant-scoped — only the caller's own account history shows up. The
 * cross-account benchmark (built in P5.4) is the other half of the moat;
 * playbooks are per-account, benchmarks are cross-account.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  decisionContextsTable,
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";

export type PlaybookEntry = {
  id: string; // savings record id (stable across queries)
  vendorName: string;
  productName: string;
  decision: string;
  decisionAt: Date | null;
  savedAnnualUsdCents: number;
  baselineAnnualUsdCents: number;
  newAnnualUsdCents: number;
  /** Decision kind: cancelled, downgraded, renegotiated, avoided_increase. */
  kind: string;
  /** Free-text rationale codes the user picked (e.g. cost_reduction). */
  rationaleCodes: string[];
  /** What lever got the vendor to the table. Null if "none". */
  negotiationLever: string | null;
  /** What other tools were evaluated. */
  alternativesConsidered: string | null;
};

/**
 * List every savings-producing decision for the account, newest first.
 *
 * Filters out the "renewed" decision case because renewal-at-flat-rate
 * doesn't produce a savings row — that's the no-op case. Cancellations,
 * downgrades, and renegotiations DO produce a row and are the entries
 * worth surfacing in the playbook library.
 */
export async function listAccountPlaybook(
  accountId: string,
  options: { limit?: number } = {}
): Promise<PlaybookEntry[]> {
  const rows = await db
    .select({
      id: savingsRecordsTable.id,
      decision: renewalEventsTable.decision,
      decisionAt: renewalEventsTable.decisionAt,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      savedAnnualUsdCents: savingsRecordsTable.savedAnnualUsdCents,
      baselineAnnualUsdCents: savingsRecordsTable.baselineAnnualUsdCents,
      newAnnualUsdCents: savingsRecordsTable.newAnnualUsdCents,
      kind: savingsRecordsTable.kind,
      rationaleCodesJson: decisionContextsTable.rationaleCodesJson,
      negotiationLever: decisionContextsTable.negotiationLever,
      alternativesConsidered: decisionContextsTable.alternativesConsidered,
    })
    .from(savingsRecordsTable)
    .innerJoin(
      renewalEventsTable,
      eq(savingsRecordsTable.renewalEventId, renewalEventsTable.id)
    )
    .innerJoin(
      subscriptionsTable,
      eq(savingsRecordsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .leftJoin(
      decisionContextsTable,
      eq(decisionContextsTable.renewalEventId, renewalEventsTable.id)
    )
    .where(and(eq(savingsRecordsTable.accountId, accountId)))
    .orderBy(desc(renewalEventsTable.decisionAt))
    .limit(options.limit ?? 200);

  return rows.map((r) => ({
    id: r.id,
    vendorName: r.vendorName,
    productName: r.productName,
    decision: r.decision ?? "",
    decisionAt: r.decisionAt,
    savedAnnualUsdCents: r.savedAnnualUsdCents,
    baselineAnnualUsdCents: r.baselineAnnualUsdCents,
    newAnnualUsdCents: r.newAnnualUsdCents,
    kind: r.kind,
    rationaleCodes: Array.isArray(r.rationaleCodesJson)
      ? (r.rationaleCodesJson as string[])
      : [],
    negotiationLever:
      r.negotiationLever && r.negotiationLever !== "none"
        ? r.negotiationLever
        : null,
    alternativesConsidered: r.alternativesConsidered,
  }));
}
