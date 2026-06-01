/**
 * Deterministic intent classifier for the grounded Ask assistant. Pure keyword
 * routing over a fixed, closed set of intents — no model, no network. Each
 * intent maps to a known retrieval path (see application/assistant/retrieve).
 * Order matters: the most specific patterns win first.
 */

export type AskIntent =
  | "cross_document"
  | "vendor_benchmark"
  | "vendor_spend"
  | "expiring_compliance"
  | "savings_summary"
  | "account_risk"
  | "needs_you"
  | "upcoming_renewals"
  | "kpis"
  | "unknown";

const MATCHERS: Array<{ intent: AskIntent; any: string[] }> = [
  // Multi-document synthesis — compare/rank across the account's OWN contracts.
  // First so self-scoped comparatives ("compare my contracts") beat the
  // cross-ACCOUNT benchmark ("compare to peers").
  {
    intent: "cross_document",
    any: [
      "which of", "which vendor", "which subscription", "which contract",
      "which one", "across all", "across my", "all my", "all of my",
      "list all", "list my", "each of", "every subscription", "every contract",
      "compare my", "strictest", "loosest", "longest notice", "shortest notice",
      "most expensive", "cheapest", "rank my", "rank them", "highest cost", "lowest cost",
    ],
  },
  // Cross-account "what's typical" — must beat vendor_spend ("compare to others").
  { intent: "vendor_benchmark", any: ["benchmark", "typical", "compare", "peers", "industry", "average for", "vs other", "versus other"] },
  // Compliance / certs / insurance — beats the generic "expiring" of renewals.
  { intent: "expiring_compliance", any: ["compliance", "certificate", "certs", "soc 2", "soc2", "insurance", "dpa", "audit doc"] },
  { intent: "savings_summary", any: ["saving", "saved", "savings"] },
  { intent: "account_risk", any: ["risk", "urgent", "biggest", "exposure", "at risk", "most important"] },
  { intent: "needs_you", any: ["needs you", "need me", "attention", "action item", "to do", "to-do", "todo", "what should i"] },
  // Per-vendor spend — implies a vendor name in the question (resolved later).
  { intent: "vendor_spend", any: ["spend on", "spending on", "how much", "cost of", "pay for", "paying"] },
  { intent: "upcoming_renewals", any: ["renew", "renewal", "due", "upcoming", "next month", "expir", "coming up"] },
  { intent: "kpis", any: ["kpi", "overview", "how are we doing", "total spend", "dashboard", "summary", "snapshot"] },
];

export function classifyIntent(question: string): AskIntent {
  const q = question.toLowerCase();
  for (const m of MATCHERS) {
    if (m.any.some((kw) => q.includes(kw))) return m.intent;
  }
  return "unknown";
}
