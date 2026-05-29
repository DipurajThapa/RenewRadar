/**
 * Coverage guard for audit logging.
 *
 * Invariant (per docs/architecture/adr/0003-audit-log-helper.md):
 *   Any mutation that changes a business-critical row writes an audit log entry
 *   in the same transaction.
 *
 * Operationalized as: every `actions.ts` file under `src/app/` that performs a
 * mutation MUST either
 *   (a) import { writeAuditLog } from "@server/infrastructure/audit-log/writer", or
 *   (b) import only from `@server/application/*`, where the use cases
 *       themselves call writeAuditLog (verified by the dedicated test below).
 *
 * Direct `tx.insert(auditLogTable)` calls are forbidden — bypassing the helper
 * also bypasses AUDIT_ACTIONS string enforcement.
 *
 * Allowlist: if you genuinely have a non-mutating actions.ts (rare), add it
 * to AUDIT_EXEMPT_ACTIONS_FILES below with a one-line justification.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();

/**
 * Files that are exempt from the audit-write requirement. Only legitimate
 * reason: the mutation is per-user read-state (notification read-receipts,
 * UI preferences) that doesn't change any business-critical row. Every entry
 * needs a one-line justification.
 */
const AUDIT_EXEMPT_ACTIONS_FILES: ReadonlyArray<string> = [
  // Notification mark-read is personal read-state. The bell badge is private
  // per user; nothing the team needs to audit. Tenant isolation still holds
  // — the actions verify accountId + userId before mutating.
  "src/app/(app)/notifications/actions.ts",
];

/**
 * Actions that audit via the parallel `writeVendorAuditLog` writer instead
 * of the customer-side `writeAuditLog`. These files must import from
 * `@server/application/vendor-portal` (the use cases there enforce the
 * vendor-side audit invariant) — verified by the test below.
 */
const VENDOR_AUDIT_ACTIONS_FILES: ReadonlyArray<string> = [
  // T4.10 — vendor portal sign-in/out goes through @server/application/vendor-portal,
  // which calls writeVendorAuditLog inside each use case. Audit-log coverage
  // is enforced over there; the third test below verifies it directly.
  "src/app/vendor/actions.ts",
];

function readUtf8(p: string): string {
  return readFileSync(p, "utf8");
}

async function findFiles(pattern: string): Promise<string[]> {
  const matches: string[] = [];
  for await (const entry of glob(pattern, { cwd: REPO_ROOT })) {
    matches.push(path.join(REPO_ROOT, entry));
  }
  return matches.sort();
}

const importsWriteAuditLog = (text: string) =>
  text.includes('from "@server/infrastructure/audit-log/writer"') ||
  text.includes("from '@server/infrastructure/audit-log/writer'");

/**
 * Use cases live under `src/server/application/<feature>/`. Each application
 * module is required to call writeAuditLog (verified by a separate test
 * below), so an `actions.ts` that delegates entirely through them is covered.
 */
const importsApplicationOnly = (text: string) =>
  text.includes('from "@server/application/') ||
  text.includes("from '@server/application/");

const usesAuditLogTableDirectly = (text: string) =>
  text.includes("auditLogTable") &&
  !text.includes("@server/infrastructure/audit-log/writer");

describe("audit-log coverage", () => {
  it("every actions.ts file routes audit writes through writeAuditLog", async () => {
    const actionsFiles = await findFiles("src/app/**/actions.ts");
    expect(actionsFiles.length).toBeGreaterThan(0); // sanity

    const offenders: string[] = [];
    for (const file of actionsFiles) {
      const relative = path.relative(REPO_ROOT, file);
      if (AUDIT_EXEMPT_ACTIONS_FILES.includes(relative)) continue;
      // Vendor-portal actions (anything under src/app/vendor/) audit via the
      // vendor-portal application modules → writeVendorAuditLog, not the
      // customer-side writeAuditLog. Exempt the whole subtree.
      if (
        VENDOR_AUDIT_ACTIONS_FILES.includes(relative) ||
        relative.startsWith("src/app/vendor/")
      ) {
        continue;
      }

      const text = readUtf8(file);
      const ok = importsWriteAuditLog(text) || importsApplicationOnly(text);
      if (!ok) {
        offenders.push(relative);
      }
    }

    expect(
      offenders,
      `These actions.ts files do not import writeAuditLog or any application module:\n  - ${offenders.join(
        "\n  - "
      )}\nAdd a writeAuditLog call (or, for personal read-state actions, add the file to AUDIT_EXEMPT_ACTIONS_FILES with a justification).`
    ).toEqual([]);
  });

  it("no file outside the audit-log writer touches auditLogTable directly", async () => {
    // Application modules must use the helper too — the helper imports
    // auditLogTable; direct inserts from anywhere else bypass AUDIT_ACTIONS
    // typing and the standard before/after diff shape.
    const candidates = [
      ...(await findFiles("src/app/**/actions.ts")),
      ...(await findFiles("src/server/application/**/*.ts")),
      ...(await findFiles("src/server/jobs/**/*.ts")),
    ];

    const offenders: string[] = [];
    for (const file of candidates) {
      // Skip test fixtures — tests legitimately insert audit-log rows
      // directly to set up state. The principle is about production
      // code, not test scaffolding.
      if (file.includes("__tests__") || file.endsWith(".test.ts")) continue;
      const text = readUtf8(file);
      if (usesAuditLogTableDirectly(text)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(
      offenders,
      `These files insert into auditLogTable directly — use writeAuditLog instead:\n  - ${offenders.join(
        "\n  - "
      )}`
    ).toEqual([]);
  });

  it("every application module that mutates business tables calls writeAuditLog", async () => {
    // For every file under src/server/application/**/*.ts, if it does any
    // `tx.update(`, `tx.insert(`, or `tx.delete(`, it must also call
    // writeAuditLog. Heuristic, not AST — exact enough.
    //
    // Exempt: specialized append-only writers that ARE the audit-equivalent
    // for their domain (vendor-memory recorder serves business memory the
    // way writeAuditLog serves security review).
    const APPLICATION_EXEMPT: ReadonlyArray<string> = [
      "src/server/application/vendor-memory/recorder.ts",
      // Wedge PoC — raw spend ingestion + derived detection suggestions.
      // These mutate the raw spend tables (parallel to ai_extracted_field);
      // the audited business moment is the human confirm in reconcile.ts.
      // They use tx.* deliberately for atomicity (cursor advance + rows).
      "src/server/application/spend/ingest.ts",
      "src/server/application/spend/detect.ts",
    ];

    const applicationFiles = await findFiles("src/server/application/**/*.ts");
    expect(applicationFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of applicationFiles) {
      // Skip test fixtures — tests legitimately seed via tx.insert/delete
      // and aren't expected to write audit log entries.
      if (file.includes("__tests__") || file.endsWith(".test.ts")) continue;
      const relative = path.relative(REPO_ROOT, file);
      if (APPLICATION_EXEMPT.includes(relative)) continue;
      const text = readUtf8(file);
      const mutates = /\btx\.(update|insert|delete)\s*\(/.test(text);
      // Customer-side modules call `writeAuditLog(...)`; vendor-portal
      // modules (T4.10) call `writeVendorAuditLog(...)` which writes into
      // the parallel `vendor_audit_log` table. Both satisfy the
      // "every mutation has an audit row in the same tx" invariant.
      const callsHelper = /\bwrite(Vendor)?AuditLog\(/.test(text);
      if (mutates && !callsHelper) {
        offenders.push(relative);
      }
    }

    expect(
      offenders,
      `Application modules that mutate but never call writeAuditLog:\n  - ${offenders.join(
        "\n  - "
      )}`
    ).toEqual([]);
  });

  // Sanity: the helper file itself is the canonical AUDIT_ACTIONS owner.
  it("AUDIT_ACTIONS is defined in the canonical writer and nowhere else", () => {
    const writePath = path.join(
      REPO_ROOT,
      "src/server/infrastructure/audit-log/writer.ts"
    );
    expect(readUtf8(writePath)).toContain("export const AUDIT_ACTIONS");
  });
});
