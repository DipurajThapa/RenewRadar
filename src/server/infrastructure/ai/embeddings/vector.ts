/**
 * Pure vector math for semantic retrieval — no IO, fully unit-tested.
 */

/** Cosine similarity. For L2-normalized inputs this is just the dot product. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** L2-normalize a vector in place-safe fashion (returns a new array). */
export function l2normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

export type RankedItem<T> = { item: T; score: number };

/**
 * Rank `items` by cosine similarity of `vectors[i]` to `queryVector`, descending.
 * `vectors` is parallel to `items`. Returns the top `topK` (all if topK<=0).
 */
export function rankBySimilarity<T>(
  queryVector: number[],
  items: T[],
  vectors: number[][],
  topK = 0
): Array<RankedItem<T>> {
  const ranked: Array<RankedItem<T>> = items.map((item, i) => ({
    item,
    score: cosineSimilarity(queryVector, vectors[i] ?? []),
  }));
  ranked.sort((a, b) => b.score - a.score);
  return topK > 0 ? ranked.slice(0, topK) : ranked;
}
