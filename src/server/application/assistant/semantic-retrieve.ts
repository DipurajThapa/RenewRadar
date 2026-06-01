/**
 * Semantic retrieval (Phase 3/A) — the vector path, lit up. Where the keyword
 * dispatch maps ONE fixed intent to ONE aggregator, this gathers a BROAD pool of
 * the account's real facts (the classified intent + the account-wide gatherers),
 * embeds the question + each fact, and returns the most semantically RELEVANT —
 * so paraphrased, cross-cutting, or off-menu questions ("am I about to lose money
 * on anything?") surface the right facts, which the fixed-enum router cannot.
 *
 * Still 100% grounded + read-only: every candidate fact comes from the
 * deterministic SQL dispatch (real account data). Embeddings only RE-RANK; they
 * never invent a fact. Default embeddings are lexical (model-free); flip
 * AI_EMBEDDINGS_PROVIDER=ollama for neural — a config swap, no code change.
 */
import type { AskIntent } from "@server/domain/assistant/intent";
import type { RetrievedFact } from "@server/infrastructure/ai/reasoning/types";
import { getEmbeddingsProvider, rankBySimilarity } from "@server/infrastructure/ai/embeddings";
import { retrieveFacts } from "./retrieve";

/** Account-wide gatherers that don't need a named entity — the candidate pool. */
const GATHER_INTENTS: AskIntent[] = [
  "account_risk",
  "needs_you",
  "upcoming_renewals",
  "savings_summary",
  "expiring_compliance",
  "kpis",
];

const TOP_K = 6;
/** Minimum cosine for a fact to count as relevant — below this, drop (honest
 *  "no data" rather than answering from noise). Lexical-embedding scale. */
const SCORE_FLOOR = 0.06;
/** A cosine this high is trusted even without a shared word — lets a NEURAL
 *  embedding's synonym match ("priciest" ↔ "cost") through, while lexical noise
 *  (which scores far lower) still needs a real shared word below. */
const NEURAL_TRUST = 0.35;

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are",
  "my", "our", "we", "i", "you", "what", "whats", "how", "when", "where",
  "which", "who", "why", "any", "much", "many", "do", "does", "with", "at",
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP.has(t))
  );
}

/** True if the question and fact share at least one real (content) word. The
 *  precision gate that stops incidental n-gram overlap (e.g. "weather") from
 *  faking relevance under the lexical embedding. */
function sharesContentWord(question: string, detail: string): boolean {
  const q = contentWords(question);
  for (const w of contentWords(detail)) if (q.has(w)) return true;
  return false;
}

export function semanticRetrievalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.AI_SEMANTIC_RETRIEVAL;
  return v !== "off" && v !== "false"; // default ON
}

export async function semanticRetrieveFacts(
  accountId: string,
  question: string,
  intent: AskIntent
): Promise<RetrievedFact[]> {
  // A CLASSIFIED intent already maps to the right precise aggregator — keep that
  // (and its honesty: a specific thing with no data → []). The semantic path is
  // the LOAD-BEARING win for `unknown` — paraphrased / off-menu questions the
  // keyword router can only answer with "[]". So semantic retrieval changes
  // behavior ONLY for `unknown`, never weakening the precise intents.
  if (intent !== "unknown") {
    return retrieveFacts(accountId, intent, question);
  }

  // `unknown` → gather a BROAD pool of the account's real facts, then rank.
  const pools = await Promise.all(
    GATHER_INTENTS.map((i) => retrieveFacts(accountId, i, question).catch(() => [] as RetrievedFact[]))
  );

  // Dedup by detail (the same headline can come from two gatherers).
  const seen = new Set<string>();
  const candidates: RetrievedFact[] = [];
  for (const f of pools.flat()) {
    const key = f.detail.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      candidates.push(f);
    }
  }
  if (candidates.length === 0) return [];

  // 2. Embed the question + each candidate's detail, rank by cosine.
  const embedder = getEmbeddingsProvider();
  const vecs = await embedder.embed([question, ...candidates.map((c) => c.detail)]);
  const queryVec = vecs[0] ?? [];
  const factVecs = vecs.slice(1);
  const ranked = rankBySimilarity(queryVec, candidates, factVecs);

  // 3. Keep only meaningfully-relevant facts: a real shared word + floor cosine,
  //    OR a high enough cosine to trust on its own (neural synonym match). If
  //    nothing qualifies, the reasoner gets [] and answers honestly.
  const relevant = ranked
    .filter(
      (r) =>
        (r.score >= SCORE_FLOOR && sharesContentWord(question, r.item.detail)) ||
        r.score >= NEURAL_TRUST
    )
    .slice(0, TOP_K)
    .map((r) => r.item);
  return relevant;
}
