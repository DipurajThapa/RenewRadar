import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  subscriptionsTable,
  supportSessionsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import { requireCurrentStaff } from "@server/middleware/current-staff";
import {
  endSupportSessionAction,
  startSupportSessionAction,
} from "@app/staff/actions";
import { getActiveSupportSession } from "@server/application/support-sessions";
import { StaffCsvImportPanel } from "@ui/features/staff/staff-csv-import-panel";
import { isUuid } from "@shared/utils";

/**
 * Per-account staff view.
 *
 * Read-only summary at the top, plus the action surfaces:
 *   - Start a session (requires reason)
 *   - End the current session (if one is active for this account)
 *   - On-behalf CSV import (only visible during an active session for THIS account)
 *
 * Session belonging to a different account: we show the read-only summary
 * but suppress action buttons; the operator must end the other session
 * first.
 */
export const dynamic = "force-dynamic";

export default async function StaffAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: accountId } = await params;
  if (!isUuid(accountId)) notFound();
  const staff = await requireCurrentStaff();

  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId))
    .limit(1);
  if (!account) notFound();

  const [subCountRow] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active")
      )
    );
  void subCountRow; // count handled via length below

  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.workEmail,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.accountId, accountId));

  const recentSessions = await db
    .select()
    .from(supportSessionsTable)
    .where(eq(supportSessionsTable.accountId, accountId))
    .orderBy(desc(supportSessionsTable.startedAt))
    .limit(8);

  const activeSession = await getActiveSupportSession(staff.id);
  const sessionMatchesThisAccount =
    activeSession?.accountId === account.id;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link
          href="/staff"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Back to accounts
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {account.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {account.billingEmail} · {account.planTier}
        </p>
      </div>

      {/* Session controls */}
      <section className="rounded-md border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Support session
        </h2>

        {sessionMatchesThisAccount && activeSession ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
              <div className="font-medium">Active for this account</div>
              <div className="text-xs text-amber-900">
                Reason: <span className="italic">{activeSession.reason}</span>
              </div>
              <div className="text-xs text-amber-900/80">
                Expires {activeSession.expiresAt.toLocaleString()} · mutations:{" "}
                {activeSession.mutationCount}
              </div>
            </div>
            <form action={endSupportSessionAction}>
              <input
                type="hidden"
                name="sessionId"
                value={activeSession.id}
              />
              <button
                type="submit"
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/40"
              >
                End session manually
              </button>
            </form>
          </div>
        ) : activeSession && !sessionMatchesThisAccount ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            You have an active session for a different account. End it before
            opening one here.
          </div>
        ) : (
          <form action={startSupportSessionAction} className="space-y-2">
            <input type="hidden" name="accountId" value={account.id} />
            <label
              htmlFor="reason"
              className="block text-xs text-muted-foreground"
            >
              Reason for support (required — this appears in the customer&apos;s
              audit log)
            </label>
            <input
              id="reason"
              name="reason"
              type="text"
              required
              placeholder="e.g. Ticket #1234 — initial onboarding data load"
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-sm font-medium"
            >
              Start support session
            </button>
          </form>
        )}
      </section>

      {/* Concierge CSV import — only visible during an active session for THIS account */}
      {sessionMatchesThisAccount && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Import subscriptions on behalf
          </h2>
          <StaffCsvImportPanel accountId={account.id} />
        </section>
      )}

      {/* Read-only data summary */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-md border bg-background p-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Users
          </div>
          <ul className="text-sm space-y-0.5">
            {users.map((u) => (
              <li key={u.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate">{u.email}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {u.role}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border bg-background p-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Recent support sessions
          </div>
          <ul className="text-xs space-y-1">
            {recentSessions.length === 0 ? (
              <li className="text-muted-foreground">
                None on file.
              </li>
            ) : (
              recentSessions.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-3">
                  <span className="truncate">
                    {s.startedAt.toLocaleDateString()} · {s.reason}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {s.endedAt ? `ended (${s.endedReason})` : "open"}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
