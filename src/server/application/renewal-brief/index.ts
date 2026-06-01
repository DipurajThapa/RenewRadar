/**
 * Wedge PoC — generate + persist a Renewal Intelligence Brief.
 *
 * [C4] The aggregator issues multiple `db` reads and MUST run BEFORE the
 * persist transaction (never inside it — nesting under the max:1 pool risks a
 * deadlock if a future caller passes top-level db). We aggregate first, call
 * the reasoning provider (pure), THEN persist + audit + vendor_event in ONE tx
 * with the tx handle passed to both writers.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalBriefsTable,
  renewalEventsTable,
  subscriptionsTable,
  type RenewalBrief,
} from "@server/infrastructure/db/schema";
import {
  recordReasoningSpend,
  resolveReasoningProvider,
} from "@server/application/ai-budget";
import { buildRenewalBriefInput } from "./aggregate";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "renewal-brief" });

export class RenewalBriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenewalBriefError";
  }
}

export async function generateAndStoreBrief(input: {
  accountId: string;
  subscriptionId: string;
  /** null = the autonomous Renewal Agent (system actor). The audit log + vendor
   *  event + createdByUserId all accept a null actor, so the brief carries
   *  honest "system" provenance when auto-prepped. */
  actorUserId: string | null;
  today?: Date;
}): Promise<RenewalBrief> {
  // 1. Aggregate (multiple reads) — OUTSIDE any transaction.
  const briefInput = await buildRenewalBriefInput(
    input.accountId,
    input.subscriptionId,
    input.today
  );
  if (!briefInput) {
    throw new RenewalBriefError("Subscription not found in this account.");
  }

  // 2. Reason. Pick the provider under the account's monthly reasoning budget:
  //    within budget → the configured engine (LLM); over budget → deterministic
  //    (free, grounded — degrade, never overbill). F3 enforcement.
  const budget = await resolveReasoningProvider(input.accountId, input.today);
  const brief = await budget.provider.buildBrief(briefInput);

  // Resolve the vendor + open renewal event for FK + timeline anchoring.
  // accountId is in every WHERE (defense-in-depth): the aggregator above
  // already proved the subscription is in this account, but these reads stay
  // self-scoping so a future refactor can't turn them into a cross-tenant leak.
  const [sub] = await db
    .select({ vendorId: subscriptionsTable.vendorId })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.id, input.subscriptionId),
        eq(subscriptionsTable.accountId, input.accountId)
      )
    );
  const [openEvent] = await db
    .select({ id: renewalEventsTable.id })
    .from(renewalEventsTable)
    .where(
      and(
        eq(renewalEventsTable.subscriptionId, input.subscriptionId),
        eq(renewalEventsTable.accountId, input.accountId)
      )
    )
    .limit(1);

  // 3. Persist + audit + vendor_event — ONE transaction, tx passed to writers.
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(renewalBriefsTable)
      .values({
        accountId: input.accountId,
        subscriptionId: input.subscriptionId,
        renewalEventId: openEvent?.id ?? null,
        engine: brief.meta.engine,
        provider: brief.meta.provider,
        model: brief.meta.model,
        promptVersion: brief.meta.promptVersion,
        briefVersion: brief.meta.briefVersion,
        recommendedAction: brief.recommendedAction,
        confidence: brief.meta.confidencePct,
        briefJson: brief,
        createdByUserId: input.actorUserId,
      })
      .returning();
    if (!row) throw new RenewalBriefError("Failed to store brief.");

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.renewalBriefGenerated,
      target: { entityType: "renewal_brief", entityId: row.id },
      after: {
        engine: brief.meta.engine,
        recommendedAction: brief.recommendedAction,
        confidencePct: brief.meta.confidencePct,
      },
    });

    if (sub?.vendorId) {
      await recordVendorEvent(tx, {
        accountId: input.accountId,
        vendorId: sub.vendorId,
        subscriptionId: input.subscriptionId,
        kind: "renewal_brief_generated",
        actorUserId: input.actorUserId,
        relatedEntityType: "renewal_brief",
        relatedEntityId: row.id,
        payload: {
          recommendedAction: brief.recommendedAction,
          engine: brief.meta.engine,
          confidencePct: brief.meta.confidencePct,
        },
      });
    }

    // F3 — charge the actual token cost to the account's monthly ledger. No-op
    // for the deterministic path (no usage), so the over-budget/offline paths
    // write nothing. Inside the tx → atomic with the brief row.
    await recordReasoningSpend(
      { accountId: input.accountId, surface: "brief", meta: brief.meta },
      tx
    );

    log.info("renewal brief generated", {
      subscriptionId: input.subscriptionId,
      engine: brief.meta.engine,
      action: brief.recommendedAction,
    });
    return row;
  });
}

export async function getLatestBrief(
  accountId: string,
  subscriptionId: string
): Promise<RenewalBrief | null> {
  // accountId-first in the WHERE clause — isolation must not depend on a
  // post-query JS filter. Newest-first, single row, resolved in SQL.
  const [row] = await db
    .select()
    .from(renewalBriefsTable)
    .where(
      and(
        eq(renewalBriefsTable.accountId, accountId),
        eq(renewalBriefsTable.subscriptionId, subscriptionId)
      )
    )
    .orderBy(desc(renewalBriefsTable.createdAt))
    .limit(1);
  return row ?? null;
}
