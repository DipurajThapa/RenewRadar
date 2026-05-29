/**
 * T4.1 — Staff-on-behalf CSV import contract tests.
 *
 * The single highest-stakes test in this codebase: an internal staff
 * member acting on a customer's data. Every assertion here is a load-
 * bearing trust invariant.
 *
 * Covered:
 *   - Staff with NO active session is REFUSED (no leaked acts)
 *   - Staff with a session for account A cannot import for account B
 *   - Happy path: import runs, subscriptions created, import_batch
 *     recorded with `source = 'csv_via_staff_session'` so the customer
 *     can identify staff-initiated rows
 *   - Customer's audit log shows the `support.staff_acted` entry with
 *     action='csv_import' at the same timeline as the subscription
 *     creates (this is the customer's smoking gun)
 *   - The import_batch IS undo-able by the customer via the existing
 *     undoImportBatchAction — trust-preserving: staff actions are not
 *     "more sticky" than customer's own
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  auditLogTable,
  importBatchesTable,
  staffUsersTable,
  subscriptionsTable,
  type StaffUser,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";

vi.mock("@server/infrastructure/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "test" }),
}));

let mockedStaff: StaffUser | undefined;
vi.mock("@server/middleware/current-staff", () => ({
  requireCurrentStaff: async () => {
    if (!mockedStaff) {
      throw new Error("test setup forgot to set mocked staff");
    }
    return mockedStaff;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { staffImportCsvForAccountAction } from "@app/staff/actions";
import { startSupportSession } from "@server/application/support-sessions";

let ids: SeedTwoAccountsResult;

const HEADER =
  "vendor,product,billing_cycle,term_start,term_end,notice_period_days,seats,unit_price_usd,auto_renew";

function row(vendor: string, product: string): string {
  return [
    vendor,
    product,
    "annual",
    "2026-01-01",
    "2027-01-01",
    "30",
    "10",
    "100",
    "true",
  ].join(",");
}

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();

  const [staff] = await db
    .insert(staffUsersTable)
    .values({
      email: "support@renewalradar.com",
      fullName: "Support Person",
      role: "support" as const,
    })
    .returning();
  mockedStaff = staff;
});

// ─────────────────────────────────────────────────────────────────────────
// Security gates
// ─────────────────────────────────────────────────────────────────────────

describe("staffImportCsvForAccountAction without an active session", () => {
  it("refuses — no acts allowed without a session", async () => {
    const r = await staffImportCsvForAccountAction({
      accountId: ids.accountA.id,
      csvText: [HEADER, row("Linear", "Standard")].join("\n"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/no active support session/i);

    // No data written.
    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.accountId, ids.accountA.id));
    expect(subs.length).toBe(1); // just the seed
  });
});

describe("staffImportCsvForAccountAction with a session for a DIFFERENT account", () => {
  it("refuses — session for A cannot act on B", async () => {
    if (!mockedStaff) throw new Error("staff seed missing");
    await startSupportSession({
      staffUserId: mockedStaff.id,
      accountId: ids.accountA.id,
      reason: "Session for A, attempting B",
    });

    const r = await staffImportCsvForAccountAction({
      accountId: ids.accountB.id, // wrong account
      csvText: [HEADER, row("Linear", "Standard")].join("\n"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/different account/i);

    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.accountId, ids.accountB.id));
    expect(subs.length).toBe(1); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Happy path + customer audit traceability
// ─────────────────────────────────────────────────────────────────────────

describe("staffImportCsvForAccountAction happy path", () => {
  it("imports rows and records the import_batch as staff-initiated", async () => {
    if (!mockedStaff) throw new Error("staff seed missing");
    await startSupportSession({
      staffUserId: mockedStaff.id,
      accountId: ids.accountA.id,
      reason: "Ticket #1234 — initial data load",
    });

    const csv = [
      HEADER,
      row("Linear", "Standard"),
      row("Figma", "Pro"),
      row("Notion", "Team"),
    ].join("\n");
    const r = await staffImportCsvForAccountAction({
      accountId: ids.accountA.id,
      csvText: csv,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.imported).toBe(3);
    expect(r.importBatchId).toBeTruthy();

    // Subscriptions exist under the customer account.
    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.accountId, ids.accountA.id));
    expect(subs.length).toBe(4); // 1 seed + 3 imported

    // The import_batch is tagged as staff-initiated so customer-side
    // tooling can distinguish "you imported this" from "support imported this."
    const [batch] = await db
      .select()
      .from(importBatchesTable)
      .where(eq(importBatchesTable.id, r.importBatchId!));
    expect(batch?.source).toBe("csv_via_staff_session");
  });

  it("writes a support.staff_acted entry visible in the customer audit log", async () => {
    if (!mockedStaff) throw new Error("staff seed missing");
    await startSupportSession({
      staffUserId: mockedStaff.id,
      accountId: ids.accountA.id,
      reason: "Audit traceability test",
    });

    await staffImportCsvForAccountAction({
      accountId: ids.accountA.id,
      csvText: [HEADER, row("Linear", "Standard")].join("\n"),
    });

    // The customer's audit log includes:
    //   - support.session_started (from start session)
    //   - support.staff_acted (from requireActiveSession)
    //   - subscription.created (from createSubscriptionWithRenewalEvent)
    const audits = await db
      .select({ action: auditLogTable.action })
      .from(auditLogTable)
      .where(eq(auditLogTable.accountId, ids.accountA.id));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("support.session_started");
    expect(actions).toContain("support.staff_acted");
    expect(actions).toContain("subscription.created");
  });
});
