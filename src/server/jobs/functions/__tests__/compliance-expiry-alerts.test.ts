/**
 * Compliance-artifact expiry alerts.
 *
 * Closes the silent gap audited in the deadline-alert cron: a compliance
 * document (SOC 2 report, insurance cert, DPA, …) with a recorded `expiresAt`
 * used to lapse with zero alert, zero digest line, zero timeline event —
 * despite "never miss a deadline" being the product's whole value prop.
 *
 * `runComplianceExpiryAlerts` is the second phase of the existing daily
 * deadline-alert cron (NOT a parallel cron). It reuses the same notification
 * dedupe + email dispatch, and emits the previously-unproduced
 * `compliance_doc_expired` vendor event.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  complianceArtifactsTable,
  notificationsTable,
  usersTable,
  vendorEventsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import { runComplianceExpiryAlerts } from "@server/jobs/functions/compliance-expiry-alerts";

/**
 * Stub email renderer. Keeps the real `.tsx` template out of the test's module
 * graph (vitest's esbuild inherits `jsx: "preserve"` and can't parse JSX) and
 * lets us assert dispatch behaviour without rendering markup.
 */
const renderStub = async () => "<html><body>compliance expiry</body></html>";

let accountId: string;
let userId: string;
let vendorId: string;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Compliance Co", billingEmail: "c@c.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "owner@c.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  userId = user!.id;
  const [vendor] = await db
    .insert(vendorsTable)
    .values({ accountId, name: "Datadog" })
    .returning();
  vendorId = vendor!.id;
});

/** Pass-through step runner — mirrors the runRenewalAgent test. */
const passThrough = <T>(_id: string, fn: () => Promise<T>) => fn();

/** Insert a compliance artifact whose expiry is `days` from now (negative = past). */
async function seedArtifact(args: {
  kind?: "soc2_type_ii_report" | "dpa" | "insurance_certificate";
  expiresInDays: number | null;
}): Promise<string> {
  const expiresAt =
    args.expiresInDays === null
      ? null
      : new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(complianceArtifactsTable)
    .values({
      accountId,
      vendorId,
      kind: args.kind ?? "soc2_type_ii_report",
      receivedAt: new Date(),
      expiresAt,
    })
    .returning();
  return row!.id;
}

async function notificationsForArtifact(artifactId: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.entityType, "compliance_artifact"),
        eq(notificationsTable.entityId, artifactId)
      )
    );
}

async function expiredEventsForArtifact(artifactId: string) {
  return db
    .select()
    .from(vendorEventsTable)
    .where(
      and(
        eq(vendorEventsTable.kind, "compliance_doc_expired"),
        eq(vendorEventsTable.relatedEntityId, artifactId)
      )
    );
}

describe("runComplianceExpiryAlerts", () => {
  it("alerts on an artifact expiring within the window — notifications + vendor event", async () => {
    const artifactId = await seedArtifact({ expiresInDays: 10 });

    const res = await runComplianceExpiryAlerts(passThrough, renderStub);

    expect(res.artifactsInWindow).toBe(1);
    expect(res.artifactsAlerted).toBe(1);
    // One owner × two channels (in_app + email).
    expect(res.notificationsCreated).toBe(2);
    expect(res.eventsRecorded).toBe(1);

    const notifs = await notificationsForArtifact(artifactId);
    expect(notifs).toHaveLength(2);
    expect(notifs.every((n) => n.trigger === "compliance_doc_expiring")).toBe(
      true
    );
    expect(new Set(notifs.map((n) => n.channel))).toEqual(
      new Set(["in_app", "email"])
    );

    const events = await expiredEventsForArtifact(artifactId);
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { artifactKind: string }).artifactKind).toBe(
      "soc2_type_ii_report"
    );
    expect(events[0]!.actorUserId).toBeNull(); // SYSTEM actor
  });

  it("is idempotent — a second run creates no new notifications and no second event", async () => {
    const artifactId = await seedArtifact({ expiresInDays: 10 });

    await runComplianceExpiryAlerts(passThrough, renderStub);
    const second = await runComplianceExpiryAlerts(passThrough, renderStub);

    expect(second.notificationsCreated).toBe(0);
    expect(second.artifactsAlerted).toBe(0);
    expect(second.eventsRecorded).toBe(0);

    // Still exactly one notification per channel and one timeline event.
    expect(await notificationsForArtifact(artifactId)).toHaveLength(2);
    expect(await expiredEventsForArtifact(artifactId)).toHaveLength(1);
  });

  it("ignores artifacts with no expiresAt", async () => {
    await seedArtifact({ expiresInDays: null });
    const res = await runComplianceExpiryAlerts(passThrough, renderStub);
    expect(res.artifactsInWindow).toBe(0);
    expect(res.notificationsCreated).toBe(0);
    expect(res.eventsRecorded).toBe(0);
  });

  it("ignores artifacts expiring beyond the window", async () => {
    await seedArtifact({ expiresInDays: 90 });
    const res = await runComplianceExpiryAlerts(passThrough, renderStub);
    expect(res.artifactsInWindow).toBe(0);
  });

  it("ignores already-expired artifacts (the pre-warning has already passed)", async () => {
    await seedArtifact({ expiresInDays: -1 });
    const res = await runComplianceExpiryAlerts(passThrough, renderStub);
    expect(res.artifactsInWindow).toBe(0);
  });

  it("records the timeline event even when the owner has muted the alert", async () => {
    // Mute both channels for the compliance trigger.
    await db
      .update(usersTable)
      .set({
        notificationPrefs: {
          compliance_doc_expiring: { email: false, in_app: false },
        },
      })
      .where(eq(usersTable.id, userId));
    const artifactId = await seedArtifact({ expiresInDays: 5 });

    const res = await runComplianceExpiryAlerts(passThrough, renderStub);

    expect(res.notificationsCreated).toBe(0); // user opted out
    expect(res.eventsRecorded).toBe(1); // timeline still reflects the expiry
    expect(await notificationsForArtifact(artifactId)).toHaveLength(0);
    expect(await expiredEventsForArtifact(artifactId)).toHaveLength(1);
  });
});
