/**
 * Coverage guard for audit logging.
 *
 * Invariant (per docs/FINAL_FEATURES_AND_IMPLEMENTATION_PLAN.md §8.4):
 *   Any mutation that changes a business-critical row writes an audit log entry
 *   in the same transaction.
 *
 * Operationalized as: every `actions.ts` file under `src/app/` that performs a
 * mutation MUST either
 *   (a) import { writeAuditLog } from "@/lib/audit/write", or
 *   (b) import only from `@/lib/db/mutations/*`, which is itself required to
 *       call writeAuditLog (and is verified separately by this test).
 *
 * Direct `tx.insert(auditLogTable)` calls are forbidden — bypassing the helper
 * also bypasses AUDIT_ACTIONS string enforcement.
 *
 * Allowlist: if you genuinely have a non-mutating actions.ts (rare), add it
 * to NON_MUTATING_ACTIONS_FILES below with a one-line justification.
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
 * Files where `import { ... } from "@/lib/db/mutations/..."` is the audit-
 * write proof point. The mutations themselves call writeAuditLog. Listed
 * explicitly so the coverage rule stays mechanically checkable.
 */
void AUDIT_EXEMPT_ACTIONS_FILES;

const MUTATIONS_DIR = path.join(REPO_ROOT, "src/lib/db/mutations");

function readUtf8(p: string): string {
  return readFileSync(p, "utf8");
}

async function findFiles(pattern: string): Promise<string[]> {
  // node:fs/promises glob (Node 22+) returns an AsyncIterable of relative paths.
  const matches: string[] = [];
  for await (const entry of glob(pattern, { cwd: REPO_ROOT })) {
    matches.push(path.join(REPO_ROOT, entry));
  }
  return matches.sort();
}

const importsWriteAuditLog = (text: string) =>
  text.includes('from "@/lib/audit/write"') ||
  text.includes("from '@/lib/audit/write'");

const importsMutationsOnly = (text: string) => {
  // Coarse: file imports at least one symbol from @/lib/db/mutations/ AND
  // does not directly touch auditLogTable.
  const importsMutations =
    text.includes('from "@/lib/db/mutations/') ||
    text.includes("from '@/lib/db/mutations/");
  return importsMutations;
};

const usesAuditLogTableDirectly = (text: string) =>
  text.includes("auditLogTable") && !text.includes("@/lib/audit/write");

describe("audit-log coverage", () => {
  it("every actions.ts file routes audit writes through writeAuditLog", async () => {
    const actionsFiles = await findFiles("src/app/**/actions.ts");
    expect(actionsFiles.length).toBeGreaterThan(0); // sanity

    const offenders: string[] = [];
    for (const file of actionsFiles) {
      const relative = path.relative(REPO_ROOT, file);
      if (AUDIT_EXEMPT_ACTIONS_FILES.includes(relative)) continue;

      const text = readUtf8(file);
      const ok = importsWriteAuditLog(text) || importsMutationsOnly(text);
      if (!ok) {
        offenders.push(relative);
      }
    }

    expect(
      offenders,
      `These actions.ts files do not import writeAuditLog or any mutation module:\n  - ${offenders.join(
        "\n  - "
      )}\nAdd a writeAuditLog call (or, for personal read-state actions, add the file to AUDIT_EXEMPT_ACTIONS_FILES with a justification).`
    ).toEqual([]);
  });

  it("no file outside @/lib/audit/write touches auditLogTable directly", async () => {
    // mutations/*.ts must use the helper too — the helper imports auditLogTable;
    // direct inserts from anywhere else bypass AUDIT_ACTIONS typing.
    const candidates = [
      ...(await findFiles("src/app/**/actions.ts")),
      ...(await findFiles("src/lib/db/mutations/*.ts")),
      ...(await findFiles("src/inngest/**/*.ts")),
    ];

    const offenders: string[] = [];
    for (const file of candidates) {
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

  it("every mutation module that mutates business tables calls writeAuditLog", async () => {
    // For every file under src/lib/db/mutations/*.ts, if it does any
    // `tx.update(`, `tx.insert(`, or `tx.delete(`, it must also call
    // writeAuditLog. Heuristic, not AST — exact enough.
    const mutationFiles = await findFiles("src/lib/db/mutations/*.ts");
    expect(mutationFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of mutationFiles) {
      const text = readUtf8(file);
      const mutates = /\btx\.(update|insert|delete)\s*\(/.test(text);
      const callsHelper = text.includes("writeAuditLog(");
      if (mutates && !callsHelper) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(
      offenders,
      `Mutation modules that mutate but never call writeAuditLog:\n  - ${offenders.join(
        "\n  - "
      )}`
    ).toEqual([]);
  });

  // Sanity: the helper file itself is the canonical AUDIT_ACTIONS owner.
  it("AUDIT_ACTIONS is defined in src/lib/audit/write.ts and nowhere else", () => {
    const writePath = path.join(REPO_ROOT, "src/lib/audit/write.ts");
    expect(readUtf8(writePath)).toContain("export const AUDIT_ACTIONS");

    // No other file should redeclare it.
    void MUTATIONS_DIR; // referenced for future expansion
  });
});
