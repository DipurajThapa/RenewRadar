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
import {
  getEmbeddingsProvider,
  rankBySimilarity,
  type RankedItem,
} from "@server/infrastructure/ai/embeddings";
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
/**
 * Relevance is a per-model ABSOLUTE cosine floor + a top-cluster band. The floor
 * is model-specific because the cosine SCALE differs — measured on the real fact
 * pool: an unrelated question ("weather in Tokyo") scores ≈0 lexical / ≈0.10 with
 * `all-minilm`, while genuinely on-topic questions (even pure synonyms like
 * "what should I be worried about?", which shares NO words) score ≈0.4 lexical /
 * ≈0.27–0.50 neural. The floor sits in that clean gap.
 *
 * NOTE: this floor is calibrated for `all-minilm` (short-text sentence-similarity).
 * `nomic-embed-text` does NOT separate cleanly on short structured fact strings
 * (weather ≈0.51 ≈ on-topic) — proven, and why all-minilm is the default below.
 */
const LEXICAL_FLOOR = 0.12;
const NEURAL_FLOOR = 0.18;
/** Keep only the most-relevant cluster — facts within this cosine of the top. */
const KEEP_BAND = 0.15;

/**
 * Relevance selection (pure — unit-tested). Returns the relevant facts, or [] when
 * the best match doesn't clear the model's floor (honest "no data"). Robust to a
 * homogeneous pool (a tiny single-renewal account): an absolute floor keeps every
 * on-topic fact, where a separation test would wrongly find "nothing stands out".
 */
export function selectRelevant(
  _question: string,
  ranked: Array<RankedItem<RetrievedFact>>,
  opts: { isNeural: boolean }
): RetrievedFact[] {
  if (ranked.length === 0) return [];
  const floor = opts.isNeural ? NEURAL_FLOOR : LEXICAL_FLOOR;
  const top = ranked[0]!.score; // ranked is descending
  if (top < floor) return []; // nothing clears the bar → honest no-data
  return ranked
    .filter((r) => r.score >= Math.max(floor, top - KEEP_BAND))
    .slice(0, TOP_K)
    .map((r) => r.item);
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

  // 3. Keep only what stands out (separation gate — scale-robust for lexical AND
  //    neural). Nothing stands out → the reasoner gets [] and answers honestly.
  return selectRelevant(question, ranked, {
    isNeural: embedder.providerName !== "lexical",
  });
}
