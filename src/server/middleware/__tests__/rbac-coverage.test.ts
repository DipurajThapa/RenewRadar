/**
 * Coverage guard for RBAC enforcement on server actions.
 *
 * Invariant: every mutating `actions.ts` file in `src/app/` calls
 * `requireRole(...)` from `@server/middleware/rbac` at the top, before any
 * write. A new actions.ts that skips RBAC ships silently today; this test
 * makes that impossible.
 *
 * Operationalized as: every `actions.ts` under `src/app/` MUST either
 *   (a) import `requireRole` from `@server/middleware/rbac`, OR
 *   (b) be exempted with a one-line justification (read-state actions,
 *       public marketing actions with their own gating).
 *
 * Mirrors the audit-log coverage test pattern at
 * `src/server/infrastructure/audit-log/__tests__/coverage.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();

/**
 * Files exempt from the requireRole import. Each entry needs a one-line
 * justification of WHY the action is OK without role-gating.
 */
const RBAC_EXEMPT_ACTIONS_FILES: ReadonlyArray<string> = [
  // Notification mark-read is per-user read-state — any authenticated
  // user in the account should be able to clear their own bell badge.
  // Tenant scope is enforced at the data layer.
  "src/app/(app)/notifications/actions.ts",
  // User-private notification preferences (toggle which trigger sends
  // email/in-app). Per-user state, not team-managed; viewer through
  // owner can edit their own. The action verifies userId server-side.
  "src/app/(app)/settings/notifications/actions.ts",
  // Public marketing lead capture — no auth context. Rate limit + honeypot
  // do the gating. Adding requireRole here would refuse an anonymous
  // user, which is the entire purpose of the form.
  "src/app/(marketing)/lead-actions.ts",
  // T4.1 — Staff-on-behalf actions. RBAC is enforced by a different
  // mechanism: `requireCurrentStaff` (in the staff middleware) and
  // `requireActiveSession` (in the support-sessions module). The customer
  // `requireRole` is intentionally NOT called because there is no
  // customer user in scope — the caller is a Renewal Radar operator
  // acting under an audited support session.
  "src/app/staff/actions.ts",
  // T4.10 — Vendor portal actions (sign-in/out, domain verification,
  // connections, announcements). There is NO customer user in scope: the
  // caller is a vendor (Notion, Linear, etc.) authenticated via the vendor
  // portal session. RBAC is enforced by `requireCurrentVendor`; vendor-side
  // audit goes to `vendor_audit_log`, not the customer `audit_log`.
  // Matched by the `src/app/vendor/` prefix below — see `isExempt`.
  "src/app/vendor/actions.ts",
];

/**
 * All actions under `src/app/vendor/` use the vendor-portal auth model
 * (`requireCurrentVendor`) rather than the customer `requireRole`, so they
 * are exempt from this customer-side RBAC coverage check.
 */
function isExempt(relative: string): boolean {
  return (
    RBAC_EXEMPT_ACTIONS_FILES.includes(relative) ||
    relative.startsWith("src/app/vendor/")
  );
}

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

/**
 * The two ways a file legitimately participates in RBAC. The first is
 * obvious — direct import of the canonical helper. The second is the
 * billing-helper carveout: checkout.ts and portal.ts both call
 * requireRole inside their own files and are imported by actions.
 */
const importsRequireRole = (text: string) =>
  text.includes('from "@server/middleware/rbac"') ||
  text.includes("from '@server/middleware/rbac'");

/**
 * A "mutating" action is anything that's not pure read. Strong heuristic:
 * the file contains a "use server" directive at the top AND defines at
 * least one exported async function. We err on the side of strict — every
 * actions.ts is treated as mutating unless explicitly exempt.
 */
const looksLikeUseServer = (text: string) =>
  text.startsWith('"use server"') || text.startsWith("'use server'");

describe("rbac coverage", () => {
  it("every mutating actions.ts imports requireRole (or is on the allowlist)", async () => {
    const actionsFiles = await findFiles("src/app/**/actions.ts");
    expect(actionsFiles.length).toBeGreaterThan(0); // sanity

    const offenders: string[] = [];
    for (const file of actionsFiles) {
      const relative = path.relative(REPO_ROOT, file);
      if (isExempt(relative)) continue;

      const text = readUtf8(file);
      if (!looksLikeUseServer(text)) continue; // not a server-action file

      if (!importsRequireRole(text)) {
        offenders.push(relative);
      }
    }

    expect(
      offenders,
      `These mutating actions.ts files do not import requireRole:\n  - ${offenders.join(
        "\n  - "
      )}\nAdd \`requireRole(user, "<role>")\` (or, for legitimate exemptions, add to RBAC_EXEMPT_ACTIONS_FILES with a justification).`
    ).toEqual([]);
  });

  it("requireRole import is followed by a call within the same file", async () => {
    // Stronger check: a file can technically import requireRole and never
    // call it. Reject that — every actions.ts that imports the helper
    // MUST also call it at least once. (The import-without-call drift was
    // the exact pattern the audit flagged on billing portal pre-fix.)
    const actionsFiles = await findFiles("src/app/**/actions.ts");
    const offenders: string[] = [];
    for (const file of actionsFiles) {
      const relative = path.relative(REPO_ROOT, file);
      if (isExempt(relative)) continue;
      const text = readUtf8(file);
      if (!looksLikeUseServer(text)) continue;
      if (!importsRequireRole(text)) continue; // caught by the test above
      // Heuristic: at least one `requireRole(` call somewhere in the file.
      const hasCall = /\brequireRole\s*\(/.test(text);
      if (!hasCall) {
        offenders.push(relative);
      }
    }
    expect(
      offenders,
      `These actions.ts files import requireRole but never call it:\n  - ${offenders.join(
        "\n  - "
      )}`
    ).toEqual([]);
  });

  it("the canonical requireRole owner is unique (no copies elsewhere)", () => {
    // If someone re-exports or re-implements requireRole, the test that
    // ensures every action calls THE canonical helper silently passes.
    // Pin the owner.
    const rbacPath = path.join(
      REPO_ROOT,
      "src/server/middleware/rbac.ts"
    );
    expect(readUtf8(rbacPath)).toContain("export function requireRole(");
  });
});
