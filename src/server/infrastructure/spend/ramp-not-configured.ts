import type { SpendConnector, SpendSyncResult } from "./types";

/**
 * Keys-gated Ramp adapter seam. Until the keys milestone this is dormant:
 * healthCheck returns false and fetch returns empty — it MUST NOT throw, so
 * the cron/factory degrade to the fixture connector gracefully. When
 * RAMP_CLIENT_ID/SECRET land, replace the body with the real OAuth + the
 * GET /transactions paging loop, mapping each line to SpendConnectorTransaction.
 */
export class RampSpendConnector implements SpendConnector {
  readonly providerName = "ramp";
  constructor(
    private readonly creds: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    }
  ) {}

  async healthCheck(): Promise<boolean> {
    return false; // until the keys milestone
  }

  async fetchTransactions(): Promise<SpendSyncResult> {
    // Seam only — never throws; callers degrade.
    return { transactions: [], nextCursor: null };
  }
}
