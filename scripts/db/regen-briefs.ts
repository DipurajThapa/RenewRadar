/**
 * One-off maintenance: regenerate every persisted Renewal Intelligence Brief
 * with the current aggregation logic. Briefs are append-only snapshots, so a
 * change to the brief math (e.g. the notice-deadline source or the spend-feed
 * band guard) does NOT retroactively update already-stored briefs — the demo
 * keeps showing stale numbers until each is regenerated. This refreshes them.
 *
 * Non-destructive: inserts a fresh brief row per subscription (the UI reads the
 * latest). System actor (actorUserId: null), mirroring the autonomous agent.
 *
 * Usage:  dotenv -e .env.local -- tsx scripts/db/regen-briefs.ts
 */
import { db } from "../../src/server/infrastructure/db/client";
import { renewalBriefsTable } from "../../src/server/infrastructure/db/schema";
import { generateAndStoreBrief } from "../../src/server/application/renewal-brief";

async function main() {
  const rows = await db
    .select({
      accountId: renewalBriefsTable.accountId,
      subscriptionId: renewalBriefsTable.subscriptionId,
    })
    .from(renewalBriefsTable);

  const seen = new Set<string>();
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    const key = `${r.accountId}:${r.subscriptionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const brief = await generateAndStoreBrief({
        accountId: r.accountId,
        subscriptionId: r.subscriptionId,
        actorUserId: null,
      });
      ok += 1;
      console.log(`✓ ${key} → ${brief.recommendedAction} (${brief.confidence}%)`);
    } catch (e) {
      failed += 1;
      console.error(`✗ ${key}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`\nRegenerated ${ok} brief(s), ${failed} failed, ${seen.size} unique subscriptions.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
