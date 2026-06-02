/**
 * Neural embeddings via a local Ollama embed model. Uses Ollama's `/api/embed`
 * ({model, input[]} → {embeddings}).
 *
 * Default model is `all-minilm` (sentence-similarity), NOT `nomic-embed-text`:
 * measured on this product's SHORT structured fact strings, nomic does not
 * separate relevant from irrelevant ("weather in Tokyo" ≈0.51 ≈ on-topic), while
 * all-minilm gives a clean gap (weather ≈0.10 vs on-topic ≈0.27–0.50). Pick the
 * model to the data — proven, not assumed.
 *
 * ALWAYS SAFE: any failure (no embed model pulled, server down, bad response)
 * self-falls-back to the deterministic lexical provider — so turning embeddings
 * on never breaks retrieval, it just degrades to lexical ranking.
 */
import type { EmbeddingsProvider } from "./types";
import { LexicalEmbeddingsProvider } from "./lexical";
import { l2normalize } from "./vector";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "ai.embeddings.ollama" });

type EmbedEnvelope = { embeddings?: number[][] };

export class OllamaEmbeddingsProvider implements EmbeddingsProvider {
  readonly providerName = "ollama-embed";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fallback = new LexicalEmbeddingsProvider();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.baseUrl = (env.LOCAL_LLM_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
    this.model = env.LOCAL_EMBED_MODEL || "all-minilm";
    this.timeoutMs = Number(env.LOCAL_EMBED_TIMEOUT_MS ?? 20_000);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const env = (await res.json()) as EmbedEnvelope;
      const vecs = env.embeddings;
      if (!Array.isArray(vecs) || vecs.length !== texts.length) {
        throw new Error("embed response shape mismatch");
      }
      // Normalize so cosine == dot product downstream.
      return vecs.map((v) => l2normalize(v));
    } catch (err) {
      log.warn("embeddings_fell_back_to_lexical", {
        model: this.model,
        error: (err as Error)?.message ?? String(err),
      });
      return this.fallback.embed(texts);
    } finally {
      clearTimeout(timer);
    }
  }
}
