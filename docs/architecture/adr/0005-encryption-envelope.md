# ADR 0005 — Per-account envelope encryption for integration secrets

**Status:** Accepted · **Date:** 2026-05-28

## Context

The `integration` table holds customer-provided secrets: Slack incoming webhook URLs and ICS export tokens. These are sensitive — a leaked Slack URL lets anyone post into the customer's workspace; a leaked ICS token exposes their entire renewal calendar.

We need encryption at rest beyond what Postgres TDE provides (it protects against disk theft, not against an application-level read of the table). We also need a defense-in-depth boundary so that a query bug returning rows from the wrong account cannot leak readable plaintext.

## Decision

**AES-256-GCM envelope encryption with a per-account derived key.**

1. **Master key.** A single 32-byte key, configured via `INTEGRATIONS_ENCRYPTION_KEY` (base64 or hex). Required in production — the encryption module throws on load if the env var is missing and `NODE_ENV === "production"`. In development we derive a deterministic key from a static string so tests are reproducible.
2. **Per-account DEK.** When we encrypt or decrypt for `accountId`, we derive a 32-byte key via `scrypt(masterKey, "account:${accountId}", 32)`. This means a ciphertext from account A cannot be decrypted with the master key alone — it also requires the account ID.
3. **AES-256-GCM.** Authenticated encryption. A 12-byte random IV per encryption. The 16-byte auth tag is stored alongside the ciphertext. Decryption fails (throws) on tamper.
4. **On-disk format.** A single text column `config_ciphertext` storing `<iv-base64>.<tag-base64>.<ciphertext-base64>`. Self-contained, JSON-friendly, no out-of-band metadata.
5. **API.** Two functions: `encryptJson(accountId, value)` and `decryptJson(accountId, ciphertext)`. The JSON values being encrypted are small (typically `{ webhookUrl: string }` or `{ token: string }`); no streaming required.

## Why per-account derivation

Without it, a single master-key leak compromises every customer's secrets simultaneously. With it, an attacker also needs the per-account ID to derive the key — which is non-secret but is a second factor in the failure model. More importantly: a query bug that returns rows from the wrong account cannot produce readable plaintext for the unauthorized caller, because the decrypt is keyed on the *requested* account ID, not the *row's* account ID.

The defense is verified in the test suite:

```ts
const ct = encryptJson(ACCOUNT_A, value);
expect(() => decryptJson(ACCOUNT_B, ct)).toThrow(); // cross-account decrypt fails
```

## Consequences

- **+** A master-key leak alone does not expose customer secrets.
- **+** A query that returns the wrong row cannot leak plaintext.
- **+** Tamper detection is built in (GCM auth tag).
- **+** Format is self-contained; no separate IV column or key-rotation metadata to manage in this initial version.
- **−** Master-key rotation is non-trivial — every ciphertext was encrypted under the current key, and re-encryption requires decrypting all rows with the old key then re-encrypting with the new. We don't have a rotation procedure documented yet; first revisit when we provision a real production key.
- **−** scrypt key derivation is intentionally slow. At V1 volumes (a handful of integration reads per cron-tick) this is invisible; we'd cache derived keys per-process if we hit a hot path.

## What this rules out

- Storing secrets in plaintext "because they're short."
- Using a single static key for all accounts.
- Encrypting Stripe secrets the same way — we don't store them; Stripe holds them.

## Revisit when

- We add a key management service (AWS KMS, GCP KMS). The envelope pattern slots in cleanly; only the `getMasterKey()` implementation changes.
- We need a documented rotation procedure (typically prompted by a security review).
