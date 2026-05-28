/**
 * Vendor event recorder.
 *
 * The single sanctioned write path to `vendor_event`. Auto-emitted from the
 * existing application use cases so memory builds without separate UX work.
 *
 * The `tx` parameter is non-optional for the same reason as `writeAuditLog`:
 * the event must succeed or fail in the same transaction as the action that
 * caused it. A subscription that exists without its `subscription_created`
 * event would be a memory gap with no obvious cause.
 *
 * Adding a new event kind:
 *   1. Add to vendorEventKindEnum in schema.ts (migration)
 *   2. Add payload type in @server/domain/vendor-memory/event-types.ts
 *   3. Add label in @server/domain/vendor-memory/event-labels.ts
 *   4. Call `recordVendorEvent` from the use case that triggers it
 */
import type { db as defaultDb } from "@server/infrastructure/db/client";
import { vendorEventsTable } from "@server/infrastructure/db/schema";
import type {
  VendorEventKind,
} from "@server/infrastructure/db/schema";
import type {
  VendorEventPayloadByKind,
} from "@server/domain/vendor-memory/event-types";

type DrizzleTx = Parameters<Parameters<typeof defaultDb.transaction>[0]>[0];
type VendorEventTx = DrizzleTx | typeof defaultDb;

export type RecordVendorEventInput<K extends VendorEventKind> = {
  accountId: string;
  vendorId: string;
  subscriptionId?: string | null;
  kind: K;
  payload: VendorEventPayloadByKind[K];
  actorUserId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  occurredAt?: Date;
};

/**
 * Record one event. Generic over kind so the TS type of `payload` is
 * narrowed to the shape associated with that kind.
 */
export async function recordVendorEvent<K extends VendorEventKind>(
  tx: VendorEventTx,
  input: RecordVendorEventInput<K>
): Promise<void> {
  await tx.insert(vendorEventsTable).values({
    accountId: input.accountId,
    vendorId: input.vendorId,
    subscriptionId: input.subscriptionId ?? null,
    kind: input.kind,
    payload: input.payload as Record<string, unknown>,
    actorUserId: input.actorUserId ?? null,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
  });
}
