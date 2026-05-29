import type { SpendConnector, SpendSyncResult } from "./types";
import { FIXTURE_TRANSACTIONS } from "./fixtures/dataset";

/**
 * The genuinely-working offline default. Deterministic, no network, no throw.
 * The cursor is an index into the dataset, so a second sync after the returned
 * cursor is a genuine no-op (proves idempotency end-to-end).
 */
export class FixtureSpendConnector implements SpendConnector {
  readonly providerName = "fixture";
  constructor(private readonly datasetId: string = "default") {}

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async fetchTransactions({
    cursor,
  }: {
    cursor: string | null;
  }): Promise<SpendSyncResult> {
    const start = cursor ? Number(cursor) : 0;
    const slice = FIXTURE_TRANSACTIONS.slice(Number.isFinite(start) ? start : 0);
    return {
      transactions: slice.map((t) => ({ ...t })),
      nextCursor: String(FIXTURE_TRANSACTIONS.length),
    };
  }
}
