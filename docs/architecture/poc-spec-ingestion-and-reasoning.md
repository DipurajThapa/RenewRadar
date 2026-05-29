# PoC Spec: Spend Ingestion + Renewal Reasoning

**Status:** Buildable implementation spec for the wedge PoC
**Scope:** Two surfaces only — automatic spend-feed ingestion (detection + reconciliation) and the Renewal Intelligence Brief. Everything else (vendor portal, intake breadth) is frozen.
**Constraint:** No paid external API keys yet. Everything runs offline behind provider seams with genuinely-working defaults — no throwing stubs in the default path.

The IP is **detection + normalization + reconciliation + multi-signal reasoning.** Ingestion and the LLM are thin pluggable seams. The only new "business" code is the detector, the normalizer-reuse glue, and the deterministic reasoning engine — all pure/offline.

This spec incorporates every fix from the technical adversarial review. Defects that would have failed CI as-written are called out inline as **[FIX Cn/Hn/Mn/Ln]**.

---

## Part 0 — Repo-grounded invariants every new file must respect

Verified against the codebase before writing:

- **`db` pool is `max: 1`** (`src/server/infrastructure/db/client.ts:15`, with `prepare: false`). Calling `db.transaction()` while already inside a `db.transaction()` via the top-level `db` (not the `tx` handle) requests a second connection that can never be granted → **deadlock.** Nested writes MUST use the passed `tx`. **[FIX C4]**
- **Audit-coverage fuse** (`src/server/infrastructure/audit-log/__tests__/coverage.test.ts`): globs `src/app/**/actions.ts` (literal filename `actions.ts` only); scans every `src/server/application/**/*.ts` for `/\btx\.(update|insert|delete)\s*\(/` and fails any matching file that doesn't call `writeAuditLog`/`writeVendorAuditLog`, unless listed in `APPLICATION_EXEMPT` (currently only `vendor-memory/recorder.ts`).
- **RBAC-coverage fuse** (`src/server/middleware/__tests__/rbac-coverage.test.ts`): globs `src/app/**/actions.ts` (literal filename only); every such file must import/call `requireRole` or be exempt.
- **Tenant-isolation fuse** (`src/server/infrastructure/db/repositories/__tests__/tenant-isolation.test.ts`): a coverage guard requires a `describe("queries/<name>")` block — **double quotes** — for every new repository file. **[FIX L3]**
- **`truncateAll()`** (`src/server/infrastructure/db/__tests__/test-harness.ts`) is a hand-maintained explicit `truncate ... restart identity cascade` list. `CASCADE` only orders the *listed* tables' FK children; it does NOT auto-discover unlisted tables. A new table not in the list is **never truncated → silent cross-test contamination, not a loud failure.** **[FIX C5]**
- **Never delete:** soft status flips only; `db.delete(usersTable)` is banned and the pattern is discouraged repo-wide.
- **Amounts in integer cents; confidence in integer 0–100.**
- **Verified-correct reuse (do not re-litigate):** `billingCycleEnum = ["monthly","quarterly","annual","multi_year"]`; `renewalDecisionEnum = ["renewed","renewed_with_adjustments","downgraded","cancelled","deferred"]`; `vendorConnectionsTable` already exists (`schema.ts:1702`, vendor-portal link) so the spend table MUST be named `spendConnectionsTable`; `price_changed` is emitted by `updateSubscription` with `deltaPct` + before/after totals; `createSubscriptionDraft` sets `status:"draft"` with placeholder dates and fires NO renewal event; `subscriptionMatchKey` and `ensureVendor` use **trim+lowercase only** (load-bearing for H1 below).

---

## PART A — SPEND INGESTION

### A.1 New Drizzle tables (`src/server/infrastructure/db/schema.ts`)

Three tables + four enums. All account-scoped, soft-delete via status flips (never `db.delete`), following the existing index / `unique(accountId, …)` conventions. The connection table is **`spendConnectionsTable`** — `vendorConnectionsTable` already exists.

#### Enums (Enums block near line 94)

```ts
export const spendConnectorKindEnum = pgEnum("spend_connector_kind", [
  "fixture",      // offline replay connector — the genuinely-working default
  "ramp",         // keys-gated adapter seam
]);

export const spendConnectionStatusEnum = pgEnum("spend_connection_status", [
  "active",
  "paused",
  "error",        // last sync failed; surfaced to user, not deleted
  "disconnected", // soft-delete terminal state (the "never delete" flip)
]);

export const spendTransactionStatusEnum = pgEnum("spend_transaction_status", [
  "ingested",     // landed from connector, not yet grouped
  "grouped",      // assigned to a detection group this run
  "ignored",      // user/heuristic marked as one-off / non-recurring
]);

export const recurringChargeStatusEnum = pgEnum("recurring_charge_status", [
  "detected",     // detector produced it; awaiting human review
  "confirmed",    // reconciled — linked to (or created) a subscription
  "dismissed",    // user said "not a subscription" (soft terminal)
  "superseded",   // a later run produced a better group for this merchant
]);
```

#### A.1a `spend_connection` — one connector binding per account per kind

Mirrors `integrationsTable` (encrypted config via the envelope) plus sync bookkeeping.

```ts
export const spendConnectionsTable = pgTable("spend_connection", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull()
    .references(() => accountsTable.id, { onDelete: "cascade" }),
  kind: spendConnectorKindEnum("kind").notNull(),
  /** Encrypted via encryptJson(accountId, config). fixture → { datasetId };
   *  ramp → { clientId, clientSecret, refreshToken }. */
  configCiphertext: text("config_ciphertext").notNull(),
  status: spendConnectionStatusEnum("status").notNull().default("active"),
  syncCursor: text("sync_cursor"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdByUserId: uuid("created_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => ({
  accountKindUnique: unique("spend_connection_account_kind_unique").on(t.accountId, t.kind),
  accountStatusIdx: index("spend_connection_account_status_idx").on(t.accountId, t.status),
}));
export type SpendConnection = typeof spendConnectionsTable.$inferSelect;
export type NewSpendConnection = typeof spendConnectionsTable.$inferInsert;
```

`unique(accountId, kind)` matches the integrations pattern (one binding per kind). Soft-delete = `status='disconnected'`, never a row delete.

#### A.1b `spend_transaction` — raw ingested card/expense lines

Idempotent on `(connectionId, externalId)` so re-syncing never double-ingests. Amounts in cents.

```ts
export const spendTransactionsTable = pgTable("spend_transaction", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull()
    .references(() => accountsTable.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull()
    .references(() => spendConnectionsTable.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),          // provider-stable id; dedup key
  rawMerchant: text("raw_merchant").notNull(),         // "RAMP *NOTION LABS"
  normalizedMerchant: text("normalized_merchant").notNull(), // output of normalizeVendorName(); detector groups on it
  mcc: text("mcc"),                                    // merchant category code; boosts confidence + collision split
  amountCents: integer("amount_cents").notNull(),      // positive = charge; negative = refund/credit
  currency: text("currency").notNull().default("USD"),
  chargedOn: date("charged_on").notNull(),             // provider posted date, YYYY-MM-DD
  cardLabel: text("card_label"),                       // last-4 / card label for the review UI
  status: spendTransactionStatusEnum("status").notNull().default("ingested"),
  /** Soft FK (no .references()) consistent with never-delete. NOTE: on
   *  supersede/dismiss this can dangle; reads MUST filter by charge status,
   *  OR null it on supersede via an audited mutation. [FIX L4] */
  recurringChargeId: uuid("recurring_charge_id"),
  rawPayloadJson: jsonb("raw_payload_json"),           // full provider line, for replay/debug
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  connExternalUnique: unique("spend_transaction_conn_external_unique").on(t.connectionId, t.externalId),
  accountMerchantChargedIdx: index("spend_transaction_account_merchant_charged_idx")
    .on(t.accountId, t.normalizedMerchant, t.chargedOn),
  accountStatusIdx: index("spend_transaction_account_status_idx").on(t.accountId, t.status),
}));
export type SpendTransaction = typeof spendTransactionsTable.$inferSelect;
export type NewSpendTransaction = typeof spendTransactionsTable.$inferInsert;
```

The `(accountId, normalizedMerchant, chargedOn)` composite is exactly the detector's read pattern.

#### A.1c `recurring_charge` — detection results (the human-review unit)

Analog of `aiExtractedFieldsTable`: detector writes `detected`; a human reviews → `confirmed`/`dismissed`. Reconciliation links it to a subscription (existing or freshly created draft).

```ts
export const recurringChargesTable = pgTable("recurring_charge", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull()
    .references(() => accountsTable.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull()
    .references(() => spendConnectionsTable.id, { onDelete: "cascade" }),
  normalizedMerchant: text("normalized_merchant").notNull(),
  currency: text("currency").notNull().default("USD"),   // [FIX M1] amount stats partitioned by currency
  suggestedVendorName: text("suggested_vendor_name").notNull(),
  detectedCycle: billingCycleEnum("detected_cycle").notNull(), // reuse → maps 1:1 into createSubscription*
  typicalAmountCents: integer("typical_amount_cents").notNull(), // median per-charge (drift-resistant)
  latestAmountCents: integer("latest_amount_cents").notNull(),
  amountDriftPct: integer("amount_drift_pct").notNull().default(0), // signed; + = price increase
  confidence: integer("confidence_pct").notNull(),       // integer 0..100 (ai_extracted_field convention)
  sampleSize: integer("sample_size").notNull(),
  /** Single large SaaS-MCC charge with no interval evidence. Surfaced as a
   *  distinct review type, never auto-projected. [FIX H4] */
  needsManualConfirm: boolean("needs_manual_confirm").notNull().default(false),
  firstChargedOn: date("first_charged_on").notNull(),
  lastChargedOn: date("last_charged_on").notNull(),
  projectedNextChargeOn: date("projected_next_charge_on"), // NULL when sampleSize<2 (don't fabricate) [FIX H4]
  status: recurringChargeStatusEnum("status").notNull().default("detected"),
  reconciliationOutcome: text("reconciliation_outcome"), // "matched_existing" | "created_draft" | null
  subscriptionId: uuid("subscription_id")
    .references(() => subscriptionsTable.id, { onDelete: "set null" }),
  reviewedByUserId: uuid("reviewed_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => ({
  accountStatusIdx: index("recurring_charge_account_status_idx").on(t.accountId, t.status),
  accountMerchantIdx: index("recurring_charge_account_merchant_idx").on(t.accountId, t.normalizedMerchant),
  /** [FIX C1] PARTIAL UNIQUE so onConflictDoUpdate has a real target AND a
   *  later detected row can coexist with a prior dismissed/superseded row for
   *  the same triple. A plain index CANNOT back ON CONFLICT — read-then-write
   *  under the cron would race and stack duplicate suggestions. */
  detectedTripleUnique: uniqueIndex("recurring_charge_detected_triple_unique")
    .on(t.connectionId, t.normalizedMerchant, t.detectedCycle)
    .where(sql`status = 'detected'`),
}));
export type RecurringCharge = typeof recurringChargesTable.$inferSelect;
export type NewRecurringCharge = typeof recurringChargesTable.$inferInsert;
```

Reusing `billingCycleEnum` for `detectedCycle` is the key reconciliation decision — a confirmed detection drops straight into `createSubscription*`'s `billingCycle` with no mapping layer.

**[FIX C1] critical:** the dedup is a **partial `uniqueIndex` `WHERE status = 'detected'`**, NOT a plain `index`. Postgres `ON CONFLICT` can target a partial unique index via `onConflictDoUpdate({ target: ..., targetWhere: sql\`status = 'detected'\` })`. This is what makes the cron-safe upsert in A.3 correct; a plain index forces racy read-then-write.

#### Schema housekeeping (mandatory fuses)

- Add **all three table names** to `truncateAll()` AND its import block in `test-harness.ts`. **[FIX C5]** Omitting them is silent cross-test contamination, not a loud failure. Strongly consider adding a meta-test diffing `Object.keys(schema)` tables against the truncate list so the next person *does* get a loud failure.
- `pnpm db:generate` to emit the migration; `pnpm db:test:migrate` for the test DB.

### A.2 SpendConnector seam (`src/server/infrastructure/spend/`)

Same shape as `crm/` and `dns/`: interface + default impl + keys-gated adapter + factory + `_setForTests`.

#### `spend/types.ts`

```ts
export interface SpendConnectorTransaction {
  externalId: string;            // provider-stable id; the dedup key
  rawMerchant: string;           // "RAMP *NOTION LABS"
  mcc: string | null;
  amountCents: number;           // positive = charge, negative = refund
  currency: string;              // ISO 4217, default "USD"
  chargedOn: string;             // YYYY-MM-DD
  cardLabel: string | null;
  raw: Record<string, unknown>;  // full provider line → rawPayloadJson
}
export interface SpendSyncResult {
  transactions: SpendConnectorTransaction[];
  nextCursor: string | null;     // persist on spend_connection.syncCursor
}
export interface SpendConnector {
  readonly providerName: string; // "fixture" | "ramp"
  healthCheck(): Promise<boolean>;
  fetchTransactions(input: { cursor: string | null; sinceDays?: number }): Promise<SpendSyncResult>;
}
```

#### `spend/fixture-connector.ts` — the genuinely-working offline default

Deterministic, no network, no throwing stub.

```ts
import type { SpendConnector, SpendSyncResult } from "./types";
import { FIXTURE_TRANSACTIONS } from "./fixtures/dataset";

export class FixtureSpendConnector implements SpendConnector {
  readonly providerName = "fixture";
  constructor(private readonly datasetId = "default") {}
  async healthCheck() { return true; }
  async fetchTransactions({ cursor }: { cursor: string | null }): Promise<SpendSyncResult> {
    const start = cursor ? Number(cursor) : 0;       // cursor = index into the dataset
    const slice = FIXTURE_TRANSACTIONS.slice(start); // second sync after the returned cursor = genuine no-op
    return { transactions: slice, nextCursor: String(FIXTURE_TRANSACTIONS.length) };
  }
}
```

> **GTM constraint (cross-ref strategy doc §3a.1):** the fixture connector is a CI harness and a keys-not-yet fallback ONLY. It is **forbidden in any partner-facing session** — partners see their own pre-loaded data. "Runs without a paid key" and "credible to a buyer" are orthogonal.

`spend/fixtures/dataset.ts` is a hand-authored array modeling ~14 months and exercising every detector branch:
- **Notion** — clean monthly flat $80 → `monthly`, conf ~95.
- **Slack** — monthly with a mid-year step ($150 → $172) → drift/price-increase, `amountDriftPct ≈ +15`, must still clear `MIN_DETECTION_CONFIDENCE`. **[FIX L5] verify the plateau-step is NOT penalized as random wobble.**
- **Datadog** — monthly, ±8% usage wobble → drift-tolerance branch.
- **GitHub** — annual single $21,000 charge → `needsManualConfirm: true`, `projectedNextChargeOn: null`, conf capped ~40. **[FIX H4]**
- **Zoom** — quarterly.
- **AWS one-offs / coffee / Uber** — irregular → REJECTED (no `recurring_charge` row).
- **One EUR-billed vendor** — forces the currency-partition test. **[FIX M1]**
- **One charge + same-amount refund pair** — must NOT produce a candidate. **[FIX H5]**
- **One "amazon"-family bucket** mixing AWS one-offs + a steady $X/mo Amazon-billed SaaS → forces MCC-split / amount-plateau sub-clustering. **[FIX M2]**
- **Linear** — already an active subscription in the seed → exercises "match existing → no draft."

#### `spend/ramp-not-configured.ts` — keys-gated adapter seam

```ts
export class RampSpendConnector implements SpendConnector {
  readonly providerName = "ramp";
  constructor(private readonly creds: { clientId: string; clientSecret: string; refreshToken: string }) {}
  async healthCheck() { return false; }                  // until keys milestone
  async fetchTransactions(): Promise<SpendSyncResult> {
    return { transactions: [], nextCursor: null };       // seam only; MUST NOT throw — callers degrade
  }
}
```

#### `spend/index.ts` — factory

```ts
import { FixtureSpendConnector } from "./fixture-connector";
import { RampSpendConnector } from "./ramp-not-configured";
import type { SpendConnector } from "./types";
import { decryptJson } from "@server/infrastructure/crypto/envelope";

let testOverride: SpendConnector | null = null;

/** [FIX M6] Build a FRESH connector per connection. The spend-sync cron
 *  iterates ALL active connections across ALL accounts; a process-wide
 *  singleton (as crm/ uses) would reuse account A's decrypted config for
 *  account B → cross-account data bleed (a tenant-isolation bug, not style).
 *  Cache ONLY the test-injection path. */
export function getSpendConnector(input: {
  accountId: string; kind: "fixture" | "ramp"; configCiphertext: string;
}): SpendConnector {
  if (testOverride) return testOverride;
  if (input.kind === "ramp") return buildRampOrFallback(input);
  const cfg = decryptJson<{ datasetId?: string }>(input.accountId, input.configCiphertext);
  return new FixtureSpendConnector(cfg.datasetId);
}

export function _setSpendConnectorForTests(c?: SpendConnector): void { testOverride = c ?? null; }

function buildRampOrFallback(input: { accountId: string; configCiphertext: string }): SpendConnector {
  const hasKeys = process.env.RAMP_CLIENT_ID && process.env.RAMP_CLIENT_SECRET;
  if (!hasKeys) {
    console.warn("[spend] kind=ramp but RAMP_* env missing; falling back to fixture connector.");
    return new FixtureSpendConnector();
  }
  const creds = decryptJson<{ clientId: string; clientSecret: string; refreshToken: string }>(
    input.accountId, input.configCiphertext);
  return new RampSpendConnector(creds);
}
```

Same fallback-with-one-time-warn discipline as `buildGoogleSheetsProviderOrFallback`. **Do NOT copy `crm/`'s process-wide cache** — see [FIX M6] above.

### A.3 Vendor-name normalization — REUSE, do not author a third normalizer **[FIX H1]**

**The critique disproved the "composes directly" claim.** `subscriptionMatchKey` and `ensureVendor` use **trim + lowercase only** (verified `subscriptions.ts:189-194`). A new aggressive `normalizeMerchant` (stripping "labs/technologies", processor prefixes, digits) produces a *different grain*: the spend feed sees "NOTION LABS" → `"notion"`, but an existing vendor named "Notion Labs Inc" has match key `notion labs inc::…` — which the normalized merchant will **never** match → missed matches and duplicate drafts on the headline demo path. There are also already **two** `normalizeVendorName` implementations (`vendor-portal/internals.ts:162`, `vendor-benchmarks/normalize.ts:50`). A third normalizer adds the fragmentation it claims to avoid.

**Fix (chosen):** reuse the **`vendor-benchmarks/normalize.ts` canonical `normalizeVendorName`** as the single normalization function for the spend feed. At ingest, `spend_transaction.normalizedMerchant = normalizeVendorName(rawMerchant)` after a thin pre-clean for processor noise (a small `stripProcessorPrefix(raw)` helper that removes `RAMP */BREX */SQ */PAYPAL *` and trailing ref-numbers, then hands off to the canonical normalizer). At reconcile (A.5) build a **two-key lookup**: try the canonical key (`normalizeVendorName(vendor.name)`) first, then the raw `subscriptionMatchKey` grain second. Do **not** ship a `normalizeMerchant`.

> Optional larger-blast-radius alternative (flagged, not chosen for the PoC): make `subscriptionMatchKey`/`listSubscriptionExistenceKeys` normalize via the same canonical function repo-wide, unifying the dedup grain. Correct long-term, but out of PoC scope; the two-key lookup is the contained fix.

`suggestedVendorName = titleCase(canonicalKey)` for display.

### A.4 Recurring-charge detection (`src/server/domain/spend/detect-recurring.ts`)

Pure, deterministic, fully unit-testable with no DB. Input: the account's `spend_transaction` rows. Output: `RecurringChargeCandidate[]`.

**Step 0 — net refunds before grouping. [FIX H5]** For each negative txn, find the nearest prior positive charge for the same `normalizedMerchant` within ±N days of similar magnitude; drop or subtract the matched pair. A fully-refunded charge must NOT count toward `sampleSize` or amount stats — a billing-dispute charge+refund must not look like a healthy 2-sample monthly sub.

**Step A — group by `(normalizedMerchant, currency)` [FIX M1], then split by MCC / amount-plateau [FIX M2].** Bucket charges (`amountCents > 0`, post-netting). When MCC is present, sub-key on `(normalizedMerchant, mcc)`; additionally sub-cluster a noisy bucket by amount-plateau so a steady $80/mo stream inside a chaotic "amazon" bucket survives rather than being drowned by AWS one-offs.

**Step B — single classifier over interval evidence. [FIX H4]** Replaces the contradictory "discard <2 immediately" + "resurrect single charge" prose with one branch:

```ts
function classifyBucket(bucket): Candidate | null {
  if (bucket.sampleSize >= 2) {
    const deltas = consecutiveDayDeltas(sortByDate(bucket));
    const cycle = classifyCadence(medianOf(deltas));   // median, not mean — robust to one skipped month
    if (!cycle) return null;                            // irregular → not recurring
    return intervalBasedCandidate(bucket, cycle, deltas);
  }
  // sampleSize === 1: NO interval evidence at all.
  if (amount >= SINGLE_CHARGE_THRESHOLD_CENTS && SAAS_MCCS.has(bucket.mcc)) {
    return {
      ...annualShape(bucket),
      detectedCycle: "annual",
      needsManualConfirm: true,
      projectedNextChargeOn: null,     // do NOT fabricate a date from one point
      confidence: clampInt(40, 0, 100),
    };
  }
  return null;                          // single small/unknown charge → reject
}

function classifyCadence(medianDays: number): BillingCycle | null {
  if (medianDays >= 26 && medianDays <= 35) return "monthly";
  if (medianDays >= 82 && medianDays <= 100) return "quarterly";
  if (medianDays >= 330 && medianDays <= 400) return "annual";
  return null;
}
```

`multi_year` is not auto-detected (needs 2+ years of feed). **[FIX M3]** Semi-annual (~182d) and bi-monthly (~60d) fall into the `null` dead zone and are silently rejected — `billingCycleEnum` has no `semi_annual`/`bi_monthly`. Documented deliberate gap; an inventory-rot miss but never a mis-bucket. Revisit post-PoC.

**Step C — amount drift / price-increase. [FIX L5]** `typicalAmountCents = median(amounts)`; `latestAmountCents = amounts[last]`. Detect a **price increase** as ≤2 stable plateaus (Slack $150→$172 held for months) and record `amountDriftPct = round((latest - priorPlateau)/priorPlateau * 100)`. **Critical:** the confidence penalty for amount variation must apply to *random wobble*, not to a clean plateau step — compute amount-CV **within each plateau**, not across the step, so a genuine price increase is NOT penalized as noise. Verify against the Slack fixture.

**Step D — confidence (integer 0–100):**
```ts
let conf = 60;
conf += Math.min(sampleSize - 1, 6) * 5;                 // +5/extra sample, cap +30
conf -= Math.round(intervalCV * 100);                    // interval regularity penalty
conf -= Math.round(Math.max(0, intraPlateauAmountCV - 0.20) * 100); // wobble above tolerance only [FIX L5]
if (mcc && SAAS_MCCS.has(mcc)) conf += 10;               // category signal
if (sampleSize === 1) conf = Math.min(conf, 40);         // single-charge cap [FIX H4]
confidence = clampInt(conf, 0, 100);
```
`intervalCV = stddev(deltas)/median(deltas)`. All math returns integers.

**Step E — reject one-off purchases (bias toward silence — cross-ref strategy §3d).** Reject (no candidate) when ANY of: `classifyCadence === null`; `sampleSize < 2` and not the single-charge exception; `intervalCV > 0.5`; final `confidence < MIN_DETECTION_CONFIDENCE` (default 50). This rejects AWS noise, coffee, Uber spreads — they never reach review. **A false detection in front of finance is a tab-ender; a miss is invisible — tune conservative.**

### A.5 Application layer: ingest, detect, connections, reconcile

#### `application/spend/ingest.ts` — idempotent sync **[FIX C3]**

```ts
await db.transaction(async (tx) => {
  // tx.insert(...).onConflictDoNothing({ target: [connectionId, externalId] }) per row,
  // then advance spend_connection.syncCursor — atomic with the rows.
});
```
**Must keep `tx.insert` (not `db.insert`)** so the cursor advance + row inserts are atomic — `db.insert` would pass the audit regex by accident while silently abandoning atomicity (cursor advances, rows fail → permanent gap; or rows land, cursor fails → duplicates next run). This file mutates → add it to `APPLICATION_EXEMPT` with the justification "raw spend table, audited at confirm step."

#### `application/spend/detect.ts` — load → detect → upsert **[FIX C1, C3]**

Load charges via the repository, run the pure detector, then for each candidate:
```ts
await tx.insert(recurringChargesTable)
  .values(candidateRow)
  .onConflictDoUpdate({
    target: [recurringChargesTable.connectionId,
             recurringChargesTable.normalizedMerchant,
             recurringChargesTable.detectedCycle],
    targetWhere: sql`status = 'detected'`,   // the partial unique index from A.1c
    set: { /* refreshed stats, updatedAt */ },
  });
```
Re-runs UPDATE the open suggestion instead of stacking. Flip touched `spend_transaction.status='grouped'` + set `recurringChargeId` in the same `tx`. **No audit log** (derived/suggestion data, parallel to `ai_extracted_field`) — add to `APPLICATION_EXEMPT` with justification. Keep `tx.*`.

#### `application/spend/connections.ts` — `upsertSpendConnection` / `disconnectSpendConnection`

Clone of `upsertIntegration`/`disableIntegration`: encrypt config with `encryptJson(accountId, config)`, `writeAuditLog(tx, …)` inside the same `db.transaction`. New `AUDIT_ACTIONS`: `spendConnectionConfigured: "spend_connection.configured"`, `spendConnectionDisconnected: "spend_connection.disconnected"` (add to the registry FIRST — coverage test enumerates).

#### `application/spend/reconcile.ts` — confirm/match/draft/dismiss (the "advisor not agent" boundary)

Invoked **only at human-confirm**, never by the detector or cron.

1. Load the account's existing-subscription map. Build the **two-key lookup [FIX H1]**: canonical (`normalizeVendorName(vendor.name)`) first, raw `subscriptionMatchKey(suggestedVendorName, productName)` second. Product defaults to vendor name when the feed has none (the procurement-intake fallback); the review UI lets the user override before confirm.
2. **Hit → update path.** Record the link (`subscriptionId`, `reconciliationOutcome='matched_existing'`). Only if the user explicitly opted to apply the observed price, call `updateSubscription({ accountId, subscriptionId, actorUserId, patch: { unitPriceCents: latestAmountCents, billingCycle: detectedCycle } })` — that function already recomputes `totalCostPerPeriodCents`, recalculates the notice deadline, writes the mandatory audit log, and emits `price_changed`/`subscription_updated` vendor events. We add nothing; the feed's price-increase flows through existing trend machinery.
3. **Miss → draft path.** `createSubscriptionDraft({ accountId, actorUserId, vendorName: suggestedVendorName, productName, annualizedUsdCents })` where `annualizedUsdCents = annualizeCents(typicalAmountCents, detectedCycle)`. Draft is correct: the feed gives merchant + cadence + amount but NOT term dates or notice period, so an active sub would force `calculateNoticeDeadline` on invented dates and fire bogus alerts. The draft sets placeholder dates, `status='draft'` (auto-excluded from active queries), writes its own audit log, fires NO renewal event. User promotes later via the normal edit flow.

**[FIX C4] nested-tx + atomicity ordering.** Do NOT nest `updateSubscription`/`createSubscriptionDraft` (each opens its own `db.transaction`) inside the reconcile outer tx — under `max:1` that deadlocks. **Pick the order:** call `updateSubscription`/`createSubscriptionDraft` **FIRST** (top-level), capture the resulting `subscriptionId`, then do the `recurring_charge` flip + its own `recurring_charge.confirmed` audit in one outer `db.transaction`. Worst-case failure = an updated/created sub with a still-`detected`, un-linked charge — idempotent, re-confirm is safe. Document this explicitly; the two calls are sequential, not atomic. The apply-price/create-draft branches MUST NOT add a redundant audit log (the documented "callers must not double-audit" rule).

### A.6 Cron + action layer

- `src/server/jobs/functions/spend-sync.ts` — Inngest cron (`0 6 * * *`), modeled on `notice-deadline-alerts.ts`. Per active `spend_connection`: ingest then detect. **Detection-only; never auto-confirm.** Builds a fresh connector per connection (see [FIX M6]).
- `src/app/(app)/spend/actions.ts` — **literal filename `actions.ts`** so both coverage fuses see it. `confirmRecurringChargeAction` (branches: `confirm-match`, `confirm-match-apply-price`, `confirm-create-draft`, `dismiss`), `dismissRecurringChargeAction`, `connectSpendFeedAction`. Each calls `requireRole(user, "member")` at the top. Confirm-match and dismiss branches `writeAuditLog` (`recurring_charge.confirmed`/`recurring_charge.dismissed`); apply-price/create-draft branches delegate audit to the application module.

### A.7 Repository + tenant + audit + tests

- `src/server/infrastructure/db/repositories/spend.ts` — every fn takes `accountId` first, scopes `WHERE accountId = $1`: `listSpendTransactionsForDetection(accountId, connectionId)`, `listDetectedRecurringCharges(accountId)`, `getRecurringCharge(accountId, id)`, `getSpendConnection(accountId, kind)`.
- **Tenant-isolation:** add `describe("queries/spend", …)` — **double quotes [FIX L3]** — to `tenant-isolation.test.ts`. Assert A-scoped reads never see B's `spend_transaction`/`recurring_charge`; `getRecurringCharge(A.id, B_chargeId)` returns null. Extend `seedTwoAccounts` (or a local seed) with a `spend_connection` + a few `spend_transaction` + one `recurring_charge` per account.
- **New `AUDIT_ACTIONS` (add to registry before any use):** `spendConnectionConfigured`, `spendConnectionDisconnected`, `recurringChargeConfirmed`, `recurringChargeDismissed`.
- **`APPLICATION_EXEMPT` additions:** `application/spend/ingest.ts`, `application/spend/detect.ts` (with justifications). Keep `tx.*` writes; do not dodge the regex with `db.*`. **[FIX C3]**
- Tests (DB-backed Vitest, `ensureMigrated`/`truncateAll`):
  1. `domain/spend/__tests__/normalize.test.ts` — pre-clean + canonical `normalizeVendorName` composes with the two-key reconcile lookup. **[FIX H1]**
  2. `domain/spend/__tests__/detect-recurring.test.ts` — whole fixture: Notion→monthly/~95; Slack→monthly + `amountDriftPct≈+15` and clears `MIN_DETECTION_CONFIDENCE` [FIX L5]; Zoom→quarterly; GitHub→`needsManualConfirm`/conf≤40/`projectedNextChargeOn=null` [FIX H4]; Datadog→detected, lower conf; AWS/coffee/Uber→no candidate; EUR vendor→partitioned [FIX M1]; charge+refund→no candidate [FIX H5]; "amazon" mixed bucket→steady sub survives [FIX M2]. All confidences integer.
  3. `infrastructure/spend/__tests__/fixture-connector.test.ts` — second call with returned cursor yields empty (idempotency).
  4. `application/spend/__tests__/ingest.test.ts` — ingest twice → zero duplicate rows (the `(connectionId, externalId)` unique).
  5. `application/spend/__tests__/reconcile.test.ts` — Linear active sub → confirm-match links + apply-price routes through `updateSubscription` and emits `price_changed`; never-seen merchant → confirm-create-draft yields `status='draft'` with NO renewal event; dismiss flips status only; **concurrent detect runs do not stack duplicate `detected` rows [FIX C1].**
  6. `tenant-isolation.test.ts` — the `queries/spend` describe.
  7. RBAC: `spend/actions.ts` imports/calls `requireRole`.

---

## PART B — RENEWAL REASONING (the Brief)

### B.0 The honesty stance (read first)

Pain #4 is "the AI is heuristic theater." The fix is NOT to make the heuristic pretend to be an LLM. It is to (a) make the deterministic engine genuinely *compose* signals into a multi-step inference no spreadsheet cell produces, and (b) **truthfully label provenance** on every claim — `engine: "deterministic"` vs `"llm"` — so the UI never lies about what produced a sentence.

**There is no charges/invoice-line table.** The ingested charge trajectory is reconstructed from immutable append-only `vendor_event` rows: `price_changed` (carrying `afterUnitPriceCents`, `afterTotalCostPerPeriodCents`, `deltaPct`) anchored at t0 by `subscription_created` (`unitPriceCents`, `termStartDate`), ordered by `occurredAt`. This spec composes the history that exists; it does not invent a table.

### B.1 The ReasoningProvider seam (`src/server/infrastructure/ai/reasoning/`)

A *third* surface alongside `ExtractionProvider` and `AIInsightProvider`, sharing the factory and the test-reset convention. It is NOT `recommendRenewalDecision` (which takes pre-digested scalars and emits a one-paragraph blurb); the Brief composes raw multi-signal inputs into a structured, per-claim-evidenced document. They coexist.

#### `reasoning/types.ts`

```ts
import type { InsightMeta } from "@server/infrastructure/ai/types";

export type ReasoningEngine = "deterministic" | "llm";

export type ChargePoint = {
  effectiveDate: string;                 // YYYY-MM-DD
  unitPriceCents: number;
  totalCostPerPeriodCents: number;
  source: "subscription_created" | "price_changed" | "seat_count_changed"; // [FIX M5]
  vendorEventId: string;                 // provenance
};

export type RenewalBriefInput = {
  accountId: string; subscriptionId: string;
  vendorName: string; productName: string; billingCycle: string;
  annualValueCents: number; autoRenew: boolean;
  noticePeriodDays: number; termEndDate: string;
  daysUntilNoticeDeadline: number;       // precomputed by the aggregator (no clock dep in provider)
  noticeDeadlineMissed: boolean;
  hasPriceIncreaseClause: boolean; priceIncreaseClauseText: string | null;
  cancellationMethodCode: string | null;
  chargeHistory: ChargePoint[];          // oldest → newest
  benchmark: {
    sampleAccounts: number;              // INCLUDES the caller unless excludeAccountId is wired [FIX H2]
    typicalNoticePeriodDays: number | null;
    autoRenewRatePct: number | null;
    medianAnnualValueCents: number | null;
    topLevers: Array<{ lever: string; count: number }>;
    medianSavingsAnnualCents: number | null;
  } | null;
  priorDecisions: Array<{
    decision: string; negotiationLever: string; rationaleCodes: string[];
    savedAnnualUsdCents: number | null; decidedAt: string | null;
  }>;
};

export type BriefEvidence = {
  source: "charge_history" | "benchmark" | "notice_deadline" | "auto_renew_flag"
        | "price_increase_clause" | "prior_decision";
  detail: string;
  quote: string | null;                  // verbatim when source is a clause
  refId: string | null;                  // vendor_event.id / renewal_event.id
};

export type BriefClaim = {
  key: "price_trajectory" | "benchmark_position" | "renewal_risk"
     | "leverage" | "batna" | "recommended_action";
  statement: string;
  engine: ReasoningEngine;               // honest PER-CLAIM provenance
  confidencePct: number;                 // integer 0..100
  evidence: BriefEvidence[];             // empty array forbidden for emitted claims
};

export type RenewalIntelligenceBrief = {
  meta: InsightMeta & { engine: ReasoningEngine; briefVersion: string };
  headline: string;                      // ≤140 chars
  recommendedAction: "renewed" | "renewed_with_adjustments" | "downgraded" | "cancelled" | "deferred";
  claims: BriefClaim[];
  predictedNextAnnualCents: { point: number; low: number; high: number } | null; // null when <2 charge points
};

export interface ReasoningProvider {
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: string;
  buildBrief(input: RenewalBriefInput): Promise<RenewalIntelligenceBrief>;
}
```

`recommendedAction` reuses the exact `renewalDecisionEnum` union — verified 1:1.

#### Factory (modify `src/server/infrastructure/ai/index.ts`)

Parallel cached singleton + `_resetReasoningProviderForTests`, following `getInsightProvider()`'s shape.

```ts
let cachedReasoning: ReasoningProvider | null = null;
export function getReasoningProvider(): ReasoningProvider {
  if (cachedReasoning) return cachedReasoning;
  const provider = process.env.AI_EXTRACTION_PROVIDER ?? "heuristic-stub"; // [FIX L1] see note
  if (provider === "anthropic") {
    const hasKey = typeof process.env.ANTHROPIC_API_KEY === "string"
      && process.env.ANTHROPIC_API_KEY.length > 0;
    cachedReasoning = hasKey ? new AnthropicReasoningProvider() : new DeterministicReasoningProvider();
  } else {
    cachedReasoning = new DeterministicReasoningProvider();
  }
  return cachedReasoning;
}
export function _resetReasoningProviderForTests(p?: ReasoningProvider | null): void {
  cachedReasoning = p ?? null;
}
```

**[FIX L1]** This overloads `AI_EXTRACTION_PROVIDER` (the *extraction* flag) to gate a *reasoning* provider — flipping it for contract extraction also flips briefs to the key-gated Anthropic reasoner. Either add a dedicated `AI_REASONING_PROVIDER` flag (preferred) or document the coupling loudly in the factory. **Honesty rule enforced by test:** when the factory falls back, it returns `DeterministicReasoningProvider` (`providerName === "deterministic-reasoner"`, every claim `engine: "deterministic"`). The fallback NEVER mints a brief labeled `"llm"`.

### B.2 The two implementations

#### `reasoning/deterministic-provider.ts` (default, offline, genuine composition)

`providerName = "deterministic-reasoner"`, `model = "renewal-reasoner-v1"`, `promptVersion = "v1.0"`, `briefVersion = "brief-v1"`. Pure, no randomness, no clock-dependence (today arrives via the precomputed `daysUntilNoticeDeadline`), so tests assert verbatim — same discipline as `HeuristicStubProvider`.

**Why this beats a spreadsheet cell:** five inference passes *resolved against each other* — the recommendation is a function of trajectory × benchmark × urgency × leverage, not any single column, plus a next-charge prediction from the account's own history with per-claim evidence. No cell does cross-signal resolution.

#### `reasoning/anthropic-provider.ts` (gated on key — real, not a throwing-only stub)

Two-state file mirroring `anthropic-not-configured.ts`, improved: carries the pinned system prompt + the JSON tool schema (the `RenewalIntelligenceBrief` shape) so the prompt is PR-reviewable. `buildBrief()` does real work when `@anthropic-ai/sdk` is present AND the key is set: one tool-use message constrained to the Brief schema, validated against the same type, every claim re-stamped `engine: "llm"`, `meta.engine = "llm"`, `costUsdMicros` from usage. **Defense-in-depth honesty:** after parsing, run the *same `validateBrief()`* used by the deterministic engine — any LLM claim with empty `evidence`, or a `quote` that is not a verbatim substring of `priceIncreaseClauseText`, is **dropped.** The LLM cannot smuggle an unsupported claim. The prompt inherits the positioning constraint from `ANTHROPIC_INSIGHTS_SYSTEM_PROMPT`: *"You never recommend sending an email to a vendor... advisor product, not an agent."* The `recommended_action` claim phrases levers as advice ("Pull a competing quote to anchor"), never as an action the system takes.

**[FIX L2]** The dynamic-import `catch → throw NOT_CONFIGURED_MESSAGE` matches the existing `AnthropicNotConfiguredProvider` precedent (which throws on every method). State honestly: the throw is reachable only via misconfiguration (key set but SDK absent) and is acceptable per existing precedent — not a claim that it satisfies "no throwing stubs." The factory key-gate makes it unreachable in current dev/test/staging config; the default path is the genuinely-working deterministic engine.

### B.3 The aggregator — which signals, from where (`application/renewal-brief/aggregate.ts`)

`buildRenewalBriefInput(accountId, subscriptionId)` is a pure read-path (no mutation → no audit for the build itself).

| Signal | Source symbol | Used for |
|---|---|---|
| Subscription core | `getSubscriptionDetail(accountId, subscriptionId)` → `SubscriptionDetail` | trajectory anchor, value tier, clause leverage |
| Notice urgency | `daysUntilNoticeDeadline(termEndDate, noticePeriodDays, today)` + `calculateNoticeDeadline`; `noticeDeadlineMissed` from renewal_event status `missed` | urgency, action gating |
| **Charge trajectory** | `listVendorEvents(accountId, vendorId, { kinds: ["price_changed","seat_count_changed","subscription_created"] })` ordered by `occurredAt` | regression → prediction, `price_trajectory` |
| Benchmark | `getVendorBenchmark(vendorName)` — **takes vendorName ONLY, no accountId** | `benchmark_position`, `leverage`, BATNA |
| Decision context | `getVendorIntelligence(accountId, vendorId)`; `getDecisionContext` for the open event | leverage, confidence boost |
| Realized savings | `VendorIntelligence.totalSavingsLifetimeCents` + per-decision `savedAnnualUsdCents` | BATNA floor |

The aggregator threads `accountId` into every call **except `getVendorBenchmark`**, which is the deliberate cross-account read. **[FIX H2]** `getVendorBenchmark` takes only `vendorName` and its `sampleAccounts`/medians **include the calling account.** Do NOT "add" a tenant filter — that breaks the benchmark. Either (preferred) add an `excludeAccountId` param to `getVendorBenchmark` and recompute excluding self (also fixes self-comparison skew), or label brief copy honestly as "across N accounts tracking X (including yours)." Never say "N *other* accounts."

**[FIX M4] t0 anchor robustness.** `createSubscriptionDraft` writes NO `subscription_created` event (verified `subscriptions/index.ts:214-303` — only `writeAuditLog`). Feed-created drafts and possibly imported subs may have `price_changed` events with no created-anchor → a trajectory mis-dated to start at the first price change. The aggregator MUST anchor t0 at the subscription row's `termStartDate`/`createdAt` (from `getSubscriptionDetail`) when no `subscription_created` event exists — never assume the event is present.

**[FIX M5] trajectory completeness.** Reconstruct `totalCostPerPeriodCents` from BOTH `price_changed` AND `seat_count_changed` (total = unitPrice × seats at each event). A sub whose cost rose purely via seat growth would otherwise show a flat price trajectory and a wrong prediction. If you choose unit-price-only, label the claim as unit-price-only honestly.

Degrade gracefully: `benchmark = null` below the privacy floor (suppress the claim, no fabricated percentile); `chargeHistory` with 1 point → trajectory claim suppressed + `predictedNextAnnualCents = null`; `priorDecisions = []` for a first cycle.

### B.4 How the deterministic engine reasons (six passes; empty-evidence claim never emitted)

1. **Price-trajectory regression.** OLS over `ChargePoint[]` (x = days-since-t0, y = annualized `totalCostPerPeriodCents` via `annualizeCents`; ≥2 points). Project to term-end → `predictedNextAnnualCents.point`; band = point ± residual stderr (clamped ±max(8%, 1 stderr)). Worked: $1,000/mo created, one `price_changed` to $1,100/mo (+10%) 12mo later → next-renewal ≈ $14.5K/yr point, band $13.4K–$15.6K. Evidence: two `charge_history` refs. Confidence scales with point count + R² (2 pts → 65; ≥4 pts, R²>0.8 → 85).
2. **Benchmark percentile.** Compare `annualValueCents` to `medianAnnualValueCents` as a ratio → coarse band ("above/below the cross-account median by N%", never a fake P-number — the benchmark exposes median, not percentiles). Compare notice days + auto-renew to the benchmark. **[FIX H2] copy must say "including yours" unless excludeAccountId is wired.** Conf 80 at `sampleAccounts≥5`, 65 at the floor of 3. Null benchmark → claim suppressed.
3. **Renewal risk / urgency.** Composite of `daysUntilNoticeDeadline` (ramps at the existing `NOTICE_THRESHOLDS` 30/14/7), `autoRenew`, value tier, `hasPriceIncreaseClause`. Adds the clause + trajectory dimension a deadline-only view misses. Cites `notice_deadline`/`auto_renew_flag`/`price_increase_clause` (verbatim clause quote). Conf 95 missed / 88 high / 72 medium / 60 low.
4. **Leverage.** Rules over composed signals: rising trajectory + clause → "challenge the uplift clause"; `benchmark.topLevers` → surface the lever that worked for other accounts (the network-effects moat made actionable); prior own `negotiationLever ≠ none` with positive savings → "repeat your `multi_year_commit` ($X saved here)"; above-median + multi-seat → "right-size seats." ≤3 ordered levers, each tied to `benchmark`/`prior_decision` evidence.
5. **BATNA.** The most spreadsheet-impossible composition: if `autoRenew` + inside notice window + a credible alternative exists (benchmark `topLevers`/rationale shows cancellations/alternatives OR own `priorDecisions` includes `cancelled`/`downgraded`), BATNA = "walk/downgrade" with floor = max(own past `savedAnnualUsdCents`, `benchmark.medianSavingsAnnualCents`). Else BATNA = "renew at projected price" using Pass 1's prediction as the no-deal cost. Fuses cross-account behavior + own savings ledger + predicted no-deal cost. **(Cross-ref strategy §3a.2: this and the lever-memory are the only non-dashboard claims; both are null at cold-start unless prior decisions are seeded — render BATNA as the centerpiece when non-null.)**
6. **Recommended action + cross-signal resolution + validator.** Decision matrix (not one column): `noticeDeadlineMissed` → `deferred` conf 90; high urgency + rising + clause → `renewed_with_adjustments` conf 80; low urgency + flat + at/below median + small value → `renewed` conf 70; strong walk-BATNA + low-usage history → `downgraded`/`cancelled`; conflicting signals → `deferred` conf 55. **Confidence is LOWERED when passes disagree** (trajectory says renegotiate but benchmark says you're already cheap → penalty) — a static spreadsheet formula never expresses this. Then the shared **`validateBrief()`** runs: drops empty-evidence claims; verifies each `quote` is a verbatim substring of its source; sets `meta.engine = "llm"` iff any claim is `"llm"` (always `"deterministic"` here); recomputes `headline` from the recommendation + highest-confidence claim.

### B.5 Surface, persistence, audit

**Surface:** a "Renewal Intelligence Brief" card on the subscription detail + decide-now pages (where `getSubscriptionDetail` already powers the view), above the existing decision UI. Each claim renders with a provenance chip (`Deterministic` / `Claude`) and an expandable evidence disclosure (`detail` + quotes). `predictedNextAnnualCents` renders as a sparkline over `chargeHistory`. "Regenerate brief" (admin+) re-runs and re-persists.

**Persistence — new `renewal_brief` table (append, query newest):**
```ts
export const renewalBriefsTable = pgTable("renewal_brief", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  renewalEventId: uuid("renewal_event_id").references(() => renewalEventsTable.id, { onDelete: "set null" }),
  engine: text("engine").notNull(),            // "deterministic" | "llm" — honest provenance, persisted
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  briefVersion: text("brief_version").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  confidencePct: integer("confidence_pct").notNull(),
  briefJson: jsonb("brief_json").notNull(),    // full RenewalIntelligenceBrief
  costUsdMicros: integer("cost_usd_micros").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  accountSubIdx: index("renewal_brief_account_sub_idx").on(t.accountId, t.subscriptionId, t.createdAt),
}));
export type RenewalBrief = typeof renewalBriefsTable.$inferSelect;
export type NewRenewalBrief = typeof renewalBriefsTable.$inferInsert;
```
Add to `truncateAll()` + import block. **[FIX C5]**

**`application/renewal-brief/index.ts` — `generateAndStoreBrief(input)`:** wraps insert + audit + `recordVendorEvent` in ONE `db.transaction`, passing `tx` to `writeAuditLog(tx, …)` and `recordVendorEvent(tx, …)` (verified `recordVendorEvent(tx, …)` takes a tx handle — safe, no nested-tx trap). **[FIX C4]** Add `renewalBriefGenerated: "renewal_brief.generated"` to `AUDIT_ACTIONS` first. Add `renewal_brief_generated` to `vendorEventKindEnum` + `RenewalBriefGeneratedPayload { recommendedAction, engine, confidencePct }` in `event-types.ts` + a label in `event-labels.ts` (the 4-step add-event-kind ritual). **Forbid (comment) calling the aggregator inside this tx** — the aggregator issues multiple `db` reads; nesting under the persist tx risks the `max:1` deadlock if a future caller uses top-level `db`.

**Action layer — `src/app/(app)/subscriptions/[id]/actions.ts`** (NOT `brief-actions.ts` — **[FIX C2]** the coverage globs match literal `actions.ts` only; `brief-actions.ts` would silently escape both RBAC and audit fuses). `generateBriefAction` calls `requireRole(user, "member")` then ONLY the application module (which owns the audit write — caller must NOT double-audit). If a single subscription `actions.ts` already exists at that path, co-locate `generateBriefAction` in it.

### B.6 Reasoning test plan (DB-backed Vitest)

1. `reasoning/__tests__/provenance.test.ts` — no key → `DeterministicReasoningProvider`, every claim + `meta.engine === "deterministic"`; `AI_EXTRACTION_PROVIDER=anthropic` + fake key + reset → `anthropic-reasoner`. **Deterministic engine NEVER emits `"llm"`.**
2. `composition.test.ts` — seed sub + two `price_changed` events; `predictedNextAnnualCents.point` equals hand-computed OLS; verbatim `price_trajectory.statement`; run twice → identical (no clock dep).
3. `evidence.test.ts` — every emitted claim has non-empty `evidence`; any `quote` is a verbatim substring of `priceIncreaseClauseText`; an injected empty-evidence claim → dropped by `validateBrief()`.
4. `benchmark-null.test.ts` — below `MIN_BENCHMARK_SAMPLE`, no benchmark claim, no fabricated percentile.
5. `resolution.test.ts` — conflicting inputs (rising trajectory + below-median value) → recommendation confidence penalized vs the agreeing case.
6. `tenant-isolation.test.ts` — add `describe("queries/renewal-briefs")` — **double quotes [FIX L3]**; A's brief read never returns B's; aggregator with B's subscriptionId under A's accountId → null/throws.
7. `application/renewal-brief/__tests__/generate.test.ts` — `generateAndStoreBrief` writes exactly one `audit_log` (`renewal_brief.generated`) + one `vendor_event`; coverage passes because the action delegates to the module.
8. `anthropic.test.ts` — inject a fake SDK response via the dynamic-import seam; claims re-stamped `"llm"`; validator drops a fabricated quote; `costUsdMicros` populated.
9. Schema plumbing: `renewalBriefsTable` in `truncateAll()` + a tenant-isolation seed.

**Honest deterministic-vs-LLM summary:** today 100% of shipped Briefs are `DeterministicReasoningProvider`, labeled `"deterministic"` on every claim and in the persisted `renewal_brief.engine` column — it genuinely composes regression + benchmark + urgency + leverage + a derived BATNA into a cross-signal-resolved recommendation. `AnthropicReasoningProvider` is fully wired (prompt + tool schema + validator) but dormant behind the key gate; when enabled it produces the same typed Brief, re-stamped `"llm"`, subjected to the same evidence-binding validator. No surface ever labels deterministic output as LLM.

---

## PART C — Ordered, file-by-file build checklist (exact paths)

Build in this order; each step keeps CI green. Run `pnpm test` (and the coverage fuses) after every schema/action change.

1. **Schema + enums.** `src/server/infrastructure/db/schema.ts` — add A.1 (3 spend tables + 4 enums + the partial `uniqueIndex` [C1]) and B.5 (`renewalBriefsTable`, `renewal_brief_generated` in `vendorEventKindEnum`) + all inferred types. Then `pnpm db:generate` → `drizzle/*.sql`, `pnpm db:test:migrate`.
2. **Test harness.** `src/server/infrastructure/db/__tests__/test-harness.ts` — add all 4 new tables to `truncateAll()` + imports [C5]; extend `seedTwoAccounts` with spend + brief seed rows. (Optional meta-test asserting truncate-list completeness.)
3. **Audit registry + event plumbing.** `src/server/infrastructure/audit-log/writer.ts` (6 new `AUDIT_ACTIONS`); `src/server/domain/vendor-memory/event-types.ts` (`RenewalBriefGeneratedPayload`); `src/server/domain/vendor-memory/event-labels.ts` (label).
4. **Spend connector seam.** `src/server/infrastructure/spend/{types,fixture-connector,ramp-not-configured,index}.ts` (factory per-connection, NOT cached [M6]) + `spend/fixtures/dataset.ts` (all detector-branch cases incl. EUR, refund pair, amazon-mixed, Linear).
5. **Pure domain — detector.** `src/server/domain/spend/detect-recurring.ts` (Steps 0–E with [H4][H5][M1][M2][M3][L5] fixes). Reuse `vendor-benchmarks/normalize.ts`'s `normalizeVendorName` + a thin `stripProcessorPrefix` helper — do NOT author `normalizeMerchant` [H1]. Unit test it standalone.
6. **Spend repository + tenant block.** `src/server/infrastructure/db/repositories/spend.ts` (accountId-first) + `describe("queries/spend")` in `tenant-isolation.test.ts` [L3].
7. **Spend application.** `application/spend/{ingest,detect,connections,reconcile}.ts`. Keep `tx.*`; add `ingest.ts` + `detect.ts` to `APPLICATION_EXEMPT` [C3]; reconcile uses the two-key lookup [H1] + the call-sub-first-then-flip ordering [C4]; reuse `listSubscriptionExistenceKeys`, `subscriptionMatchKey`, `ensureVendor`, `createSubscriptionDraft`, `updateSubscription`, `annualizeCents`.
8. **Spend cron + actions.** `src/server/jobs/functions/spend-sync.ts` (ingest→detect, no auto-confirm); `src/app/(app)/spend/actions.ts` (literal filename; `requireRole`). Run the spend test suite (A.7).
9. **Reasoning seam + engine.** `src/server/infrastructure/ai/reasoning/{types,validate,deterministic-provider,anthropic-provider}.ts`; wire `getReasoningProvider()` + `_resetReasoningProviderForTests()` in `ai/index.ts` (dedicated flag or documented coupling [L1]).
10. **Reasoning aggregator + persist.** `application/renewal-brief/aggregate.ts` (t0-anchor fallback [M4], seat+price trajectory [M5], benchmark-include-self honesty [H2]); `application/renewal-brief/index.ts` (`generateAndStoreBrief`, one tx, `tx`-passed audit + event [C4]); `repositories/renewal-briefs.ts` + its `describe("queries/renewal-briefs")` block [L3].
11. **Reasoning action + UI.** `src/app/(app)/subscriptions/[id]/actions.ts` (`generateBriefAction`, literal filename [C2]); `renewal-brief-card.tsx` + sparkline.
12. **Full reasoning test suite** (B.6). Then run all coverage fuses end-to-end: tenant-isolation, audit-coverage, rbac-coverage, the `db.delete(usersTable)` ban.

### Reused symbols (exact) — do NOT duplicate

`listSubscriptionExistenceKeys(accountId)`, `subscriptionMatchKey(vendorName, productName)`, `ensureVendor({accountId,name})`, `createSubscriptionDraft({accountId,actorUserId,vendorName,productName,annualizedUsdCents})`, `updateSubscription({accountId,subscriptionId,actorUserId,patch})`, `createSubscriptionWithRenewalEvent`, `annualizeCents(cents, cycle)`, `getSubscriptionDetail`, `listVendorEvents`, `getVendorBenchmark` (vendorName only), `getVendorIntelligence`, `getDecisionContext`, `daysUntilNoticeDeadline`/`calculateNoticeDeadline`, `recordVendorEvent(tx, …)`, `writeAuditLog(tx, …)` + `AUDIT_ACTIONS`, `encryptJson/decryptJson(accountId, …)`, `requireRole(user, role)`, `normalizeVendorName` (from `vendor-benchmarks/normalize.ts`), `billingCycleEnum`, `renewalDecisionEnum`, `InsightMeta`, `seedTwoAccounts`/`truncateAll`/`ensureMigrated`. **Must NOT be duplicated:** a third vendor-name normalizer [H1]; a charges/invoice table (reconstruct from `vendor_event` [B.0]); any audit write inside reconcile's apply-price/create-draft branches [C4]; the `crm/` process-wide connector cache [M6].

### Naming caveats flagged
- Use **`spendConnectionsTable`**, not `vendorConnectionsTable` (the latter exists, vendor-portal, in `truncateAll` already).
- Action files MUST be literally `actions.ts` (not `brief-actions.ts`) to be seen by both coverage globs [C2].
- Tenant-isolation describe blocks MUST use **double quotes** `describe("queries/<name>")` [L3].
