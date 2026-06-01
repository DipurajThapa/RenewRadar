/**
 * Embeddings seam (Phase 3/A) — turns text into a vector so retrieval can rank by
 * SEMANTIC relevance, which the fixed-enum keyword router structurally cannot do.
 *
 * Two implementations behind one interface:
 *   - LexicalEmbeddingsProvider  — deterministic, model-free (hashed char n-gram
 *     vectors). The always-available default: works in CI, handles typos/word
 *     order, ranks ANY fact against ANY question. Lexical, not neural-paraphrase.
 *   - OllamaEmbeddingsProvider    — true neural embeddings via a local embed model
 *     (LOCAL_EMBED_MODEL, e.g. `nomic-embed-text`). A config swap, no code change;
 *     self-falls-back to lexical when the model is unavailable.
 */
export interface EmbeddingsProvider {
  readonly providerName: string;
  /** Embed each input string into a fixed-length, L2-normalized vector. */
  embed(texts: string[]): Promise<number[][]>;
}
