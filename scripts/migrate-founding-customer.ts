/**
 * Founding Customer Migration Helper
 *
 * Bulk-creates subscriptions for a founding customer from a CSV file,
 * skipping the manual data-entry step during the migration call.
 *
 * Usage:
 *   1. Customer signs up via your normal flow at /sign-up. Note their clerk_user_id.
 *   2. Look up their account ID:
 *        SELECT id FROM account WHERE billing_email = 'customer@example.com';
 *   3. Prepare a CSV (see schema below).
 *   4. Run this script with the account ID and CSV path:
 *
 *        ACCOUNT_ID="<uuid>" \
 *        CSV_PATH="./customer-subscriptions.csv" \
 *        ACTOR_USER_ID="<your-clerk-user-id>" \
 *        pnpm tsx scripts/migrate-founding-customer.ts
 *
 * CSV schema (columns in this order; one row per subscription):
 *
 *   vendor_name,product_name,plan_name,billing_cycle,term_start_date,term_end_date,total_seats,unit_price_dollars,notice_period_days,auto_renew,notes
 *
 * Example:
 *
 *   Atlassian,Jira Software,Standard,annual,2025-07-14,2026-07-14,50,12.00,30,true,"Locked at $12 — renegotiated 2024-Q4"
 *   Datadog,Pro,Pro,annual,2025-04-21,2026-04-21,10,70.00,30,true,
 */

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  accountsTable,
  usersTable,
  subscriptionsTable,
  vendorsTable,
  renewalEventsTable,
  auditLogTable,
} from "../src/lib/db/schema";
import { calculateNoticeDeadline } from "../src/lib/notice-deadline/calculate";

type CsvRow = {
  vendorName: string;
  productName: string;
  planName: string;
  billingCycle: "monthly" | "quarterly" | "annual" | "multi_year";
  termStartDate: string;
  termEndDate: string;
  totalSeats: number;
  unitPriceCents: number;
  noticePeriodDays: number;
  autoRenew: boolean;
  notes: string;
};

async function main() {
  const accountId = process.env.ACCOUNT_ID;
  const csvPath = process.env.CSV_PATH;
  const actorUserId = process.env.ACTOR_USER_ID;

  if (!accountId || !csvPath || !actorUserId) {
    console.error(
      "Missing env vars. Required: ACCOUNT_ID, CSV_PATH, ACTOR_USER_ID"
    );
    process.exit(1);
  }

  // Verify the account exists
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));

  if (!account) {
    console.error(`Account ${accountId} not found`);
    process.exit(1);
  }

  // Verify the actor user belongs to this account (safety check)
  const [actor] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, actorUserId));

  if (!actor || actor.accountId !== accountId) {
    console.error(
      `Actor user ${actorUserId} not found or does not belong to account ${accountId}`
    );
    process.exit(1);
  }

  console.log(`Migrating subscriptions into "${account.name}" (${account.id})`);

  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  console.log(`Found ${rows.length} subscriptions in CSV.`);

  let created = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await db.transaction(async (tx) => {
        // 1. Ensure vendor exists (case-insensitive lookup, then insert)
        const accountVendors = await tx
          .select()
          .from(vendorsTable)
          .where(eq(vendorsTable.accountId, accountId));

        let vendor = accountVendors.find(
          (v) => v.name.toLowerCase() === row.vendorName.toLowerCase()
        );

        if (!vendor) {
          const [newVendor] = await tx
            .insert(vendorsTable)
            .values({
              accountId,
              name: row.vendorName,
            })
            .returning();
          if (!newVendor) throw new Error("Failed to create vendor");
          vendor = newVendor;
        }

        // 2. Insert subscription
        const totalCostPerPeriodCents = row.unitPriceCents * row.totalSeats;

        const [subscription] = await tx
          .insert(subscriptionsTable)
          .values({
            accountId,
            vendorId: vendor.id,
            productName: row.productName,
            planName: row.planName || null,
            billingCycle: row.billingCycle,
            termStartDate: row.termStartDate,
            termEndDate: row.termEndDate,
            autoRenew: row.autoRenew,
            noticePeriodDays: row.noticePeriodDays,
            totalSeats: row.totalSeats,
            unitPriceCents: row.unitPriceCents,
            totalCostPerPeriodCents,
            status: "active",
            notes: row.notes || null,
            ownerUserId: actorUserId,
          })
          .returning();

        if (!subscription) throw new Error("Failed to create subscription");

        // 3. Emit renewal event
        const noticeDeadline = calculateNoticeDeadline(
          subscription.termEndDate,
          subscription.noticePeriodDays
        );

        await tx.insert(renewalEventsTable).values({
          subscriptionId: subscription.id,
          accountId,
          renewalDate: subscription.termEndDate,
          noticeDeadline: noticeDeadline.toISOString().split("T")[0]!,
          status: "upcoming",
        });

        // 4. Audit log
        await tx.insert(auditLogTable).values({
          accountId,
          actorUserId,
          action: "subscription.created",
          targetEntityType: "subscription",
          targetEntityId: subscription.id,
          after: {
            source: "founding_customer_migration",
            ...(subscription as unknown as Record<string, unknown>),
          },
        });

        console.log(
          `  ✓ ${row.vendorName} — ${row.productName} (renews ${row.termEndDate})`
        );
        created++;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `  ✗ Failed: ${row.vendorName} — ${row.productName}: ${msg}`
      );
      failed++;
    }
  }

  console.log("");
  console.log(`Done. Created ${created}, failed ${failed}.`);
  process.exit(failed > 0 ? 1 : 0);
}

function parseCsv(content: string): CsvRow[] {
  const lines = content
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));

  // Skip the header row
  const dataLines = lines.slice(1);

  return dataLines.map((line, idx) => {
    const fields = splitCsvLine(line);
    if (fields.length < 11) {
      throw new Error(
        `Line ${idx + 2}: expected 11 columns, got ${fields.length}`
      );
    }

    return {
      vendorName: fields[0]!.trim(),
      productName: fields[1]!.trim(),
      planName: fields[2]!.trim(),
      billingCycle: fields[3]!.trim() as CsvRow["billingCycle"],
      termStartDate: fields[4]!.trim(),
      termEndDate: fields[5]!.trim(),
      totalSeats: Number.parseInt(fields[6]!.trim(), 10),
      unitPriceCents: Math.round(Number.parseFloat(fields[7]!.trim()) * 100),
      noticePeriodDays: Number.parseInt(fields[8]!.trim(), 10),
      autoRenew: fields[9]!.trim().toLowerCase() === "true",
      notes: fields[10]!.trim(),
    };
  });
}

/**
 * Minimal CSV line parser handling quoted fields (for notes that contain commas).
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip the escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
