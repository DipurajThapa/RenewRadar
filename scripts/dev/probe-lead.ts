/**
 * Dev-only smoke test: invoke captureLead once against the dev database and
 * print the result. Use this to confirm the form pipeline writes to the
 * `lead` table without spinning up a real browser submission.
 *
 *   pnpm exec tsx scripts/dev/probe-lead.ts
 */
import { captureLead } from "@server/application/leads";

async function main(): Promise<number> {
  const email = `dipuraj.thapa+probe-${Date.now()}@gmail.com`;

  const result = await captureLead({
    email,
    fullName: "Dipuraj Thapa (probe)",
    company: "Renewal Radar QA",
    jobTitle: "Dev",
    message: "End-to-end smoke test via scripts/dev/probe-lead.ts",
    source: "marketing_home_final_cta",
    intent: "demo",
    consentMarketing: true,
  });

  console.log("captureLead result:", JSON.stringify(result, null, 2));

  // Give the fire-and-forget CRM push one tick to log before we exit.
  await new Promise((r) => setTimeout(r, 50));
  return result.ok ? 0 : 1;
}

main().then((code) => process.exit(code));
