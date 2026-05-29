/**
 * Wedge PoC — SpendConnector seam.
 *
 * A connector is the ONLY thing that differs between an offline fixture and a
 * live Ramp/Brex feed. Everything downstream (detection, reconciliation,
 * reasoning) is provider-agnostic and operates on `SpendConnectorTransaction`.
 * This is the "one automatic ingestion path" — the fix for pain point #1.
 */
export interface SpendConnectorTransaction {
  /** Provider-stable id; the idempotency/dedup key for re-syncs. */
  externalId: string;
  /** As the provider reports it, e.g. "RAMP *NOTION LABS". */
  rawMerchant: string;
  /** Merchant category code; boosts SaaS confidence + splits collisions. */
  mcc: string | null;
  /** Integer cents. Positive = charge; negative = refund/credit. */
  amountCents: number;
  /** ISO 4217. */
  currency: string;
  /** Provider posted date, YYYY-MM-DD. */
  chargedOn: string;
  /** Last-4 / card label for the review UI. */
  cardLabel: string | null;
  /** Full provider line, retained for replay/debug. */
  raw: Record<string, unknown>;
}

export interface SpendSyncResult {
  transactions: SpendConnectorTransaction[];
  /** Opaque cursor persisted on spend_connection.syncCursor. */
  nextCursor: string | null;
}

export interface SpendConnector {
  readonly providerName: string; // "fixture" | "ramp"
  healthCheck(): Promise<boolean>;
  fetchTransactions(input: {
    cursor: string | null;
    sinceDays?: number;
  }): Promise<SpendSyncResult>;
}
