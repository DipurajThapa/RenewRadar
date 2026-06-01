/**
 * Live proof that the local LLM (qwen3.6) reads a contract and extracts fields
 * with VERBATIM evidence (the no-hallucination extraction gate).
 *
 * Run:
 *   AI_EXTRACTION_PROVIDER=ollama pnpm exec dotenv -e .env.local -- tsx scripts/ai/live-extract-proof.ts
 */
import { getExtractionProvider, _resetExtractionProviderForTests } from "@server/infrastructure/ai";

const CONTRACT = `MASTER SUBSCRIPTION AGREEMENT — Acme Analytics, Inc.

1. Term. This Agreement commences on January 1, 2026 and the initial term ends
on December 31, 2026. The subscription shall automatically renew for successive
one-year terms unless either party provides at least 60 days prior written
notice before the end of the then-current term.

2. Fees. The annual subscription fee is $24,000 per year, invoiced annually.
Fees may increase by up to seven percent (7%) at each renewal.

3. Cancellation. To cancel, Customer must notify Acme via email to
billing@acme.example before the notice deadline.`;

async function main() {
  _resetExtractionProviderForTests();
  const provider = getExtractionProvider();
  console.log(`provider: ${provider.providerName} (${provider.model})`);

  const t0 = Date.now();
  const res = await provider.extract({ text: CONTRACT, pageCount: 1 });
  const ms = Date.now() - t0;

  // Whitespace-insensitive check (contracts wrap mid-clause), matching the
  // provider's anti-fabrication gate: non-whitespace chars must appear in order.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const haystack = norm(CONTRACT);

  console.log(`\nextracted ${res.fields.length} field(s) in ${ms} ms:\n`);
  let allVerbatim = true;
  for (const f of res.fields) {
    const verbatim = haystack.includes(norm(f.evidenceQuote));
    if (!verbatim) allVerbatim = false;
    console.log(`  • ${f.fieldKey} = ${JSON.stringify(f.parsedValueJson)}  (${f.confidencePct}%)`);
    console.log(`        evidence${verbatim ? " ✓verbatim" : " ✗NOT-IN-TEXT"}: «${f.evidenceQuote}»`);
  }

  console.log(`\nall evidence verbatim: ${allVerbatim ? "PASS" : "FAIL"}`);
  if (!allVerbatim) process.exit(1);
  console.log("✓ live extraction validated (every field points to real contract text)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
