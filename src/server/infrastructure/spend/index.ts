/**
 * Wedge PoC — SpendConnector factory.
 *
 * CRITICAL [tenant safety]: a connector is built FRESH per connection, NOT
 * cached process-wide. The spend-sync cron iterates every active connection
 * across every account; a process-wide singleton (as `crm/` uses) would reuse
 * account A's decrypted config for account B → cross-account data bleed. Only
 * the test-injection path is cached.
 */
import { FixtureSpendConnector } from "./fixture-connector";
import { RampSpendConnector } from "./ramp-not-configured";
import type { SpendConnector } from "./types";
import { decryptJson } from "@server/infrastructure/crypto/envelope";
import { createLogger } from "@server/infrastructure/observability/logger";

export type { SpendConnector, SpendConnectorTransaction, SpendSyncResult } from "./types";
export { FixtureSpendConnector } from "./fixture-connector";

const log = createLogger({ component: "spend.factory" });

let testOverride: SpendConnector | null = null;

export function getSpendConnector(input: {
  accountId: string;
  kind: "fixture" | "ramp";
  configCiphertext: string;
}): SpendConnector {
  if (testOverride) return testOverride;
  if (input.kind === "ramp") return buildRampOrFallback(input);
  const cfg = decryptJson<{ datasetId?: string }>(
    input.accountId,
    input.configCiphertext
  );
  return new FixtureSpendConnector(cfg.datasetId ?? "default");
}

export function _setSpendConnectorForTests(c?: SpendConnector | null): void {
  testOverride = c ?? null;
}

function buildRampOrFallback(input: {
  accountId: string;
  configCiphertext: string;
}): SpendConnector {
  const hasKeys =
    typeof process.env.RAMP_CLIENT_ID === "string" &&
    process.env.RAMP_CLIENT_ID.length > 0 &&
    typeof process.env.RAMP_CLIENT_SECRET === "string" &&
    process.env.RAMP_CLIENT_SECRET.length > 0;
  if (!hasKeys) {
    log.warn("kind=ramp but RAMP_* env missing; falling back to fixture connector");
    return new FixtureSpendConnector();
  }
  const creds = decryptJson<{
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }>(input.accountId, input.configCiphertext);
  return new RampSpendConnector(creds);
}
