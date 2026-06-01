/**
 * Lexical embeddings — deterministic, model-free vectors from hashed character
 * 3-grams + word tokens. The always-available default for semantic retrieval:
 * no model server, runs in CI, robust to typos / word order, and ranks ANY fact
 * against ANY question (which the fixed-enum keyword router cannot). It is lexical
 * (term-overlap), NOT neural-paraphrase — set AI_EMBEDDINGS_PROVIDER=ollama with a
 * local embed model for true semantic embeddings.
 */
import type { EmbeddingsProvider } from "./types";
import { l2normalize } from "./vector";

// Large enough that ~15 active features per text rarely collide — a 256-bucket
// space produced spurious ~0.2 cosine between unrelated texts (birthday paradox).
const DIM = 4096;

// Common words carry no topical signal — dropping them stops a question like
// "what's the weather?" from faking relevance to account facts via shared
// function words (and their character n-grams).
const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are",
  "was", "were", "be", "do", "does", "did", "my", "our", "we", "i", "you",
  "what", "whats", "how", "when", "where", "which", "who", "why", "s", "it",
  "this", "that", "with", "at", "by", "from", "any", "much", "many", "me",
]);

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % DIM;
}

/** Embed one string into a fixed-dim, L2-normalized term/n-gram frequency vector. */
export function lexicalEmbed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const norm = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  const tokens = norm.split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
  const bump = (idx: number) => {
    v[idx] = (v[idx] ?? 0) + 1;
  };
  for (const tok of tokens) {
    bump(hash(tok)); // whole-word signal
    const padded = `#${tok}#`; // char 3-grams (typo/word-order robustness)
    for (let i = 0; i + 3 <= padded.length; i++) {
      bump(hash(padded.slice(i, i + 3)));
    }
  }
  return l2normalize(v);
}

export class LexicalEmbeddingsProvider implements EmbeddingsProvider {
  readonly providerName = "lexical";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => lexicalEmbed(t));
  }
}
