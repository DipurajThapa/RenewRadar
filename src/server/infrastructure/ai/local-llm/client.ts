/**
 * Local LLM client — talks to an Ollama-compatible server over plain HTTP.
 *
 * Why no SDK: Ollama exposes a stable REST API (`/api/chat`, `/api/tags`). We
 * call it with the platform `fetch` (Node 18+ / Edge), so the local-model path
 * adds ZERO new dependencies and the production build stays green whether or not
 * a model server is running.
 *
 * No hardcoded provider/model name in logic: the model + endpoint come from env
 * with a documented default. Swap `LOCAL_LLM_MODEL` to point at any installed
 * Ollama tag (qwen3.6, qwen3.5:9b, llama3.1-storm:8b, …).
 *
 * Thinking models (e.g. qwen3.6 / qwen35moe) return their chain-of-thought in a
 * separate `message.thinking` field; `message.content` is the clean answer. We
 * read ONLY `content` and ignore `thinking`, then JSON-parse it (we request
 * `format: "json"` so the model is constrained to emit a single JSON object).
 *
 * This client is intentionally dumb: it returns parsed JSON or throws a typed
 * `LocalLlmError`. All grounding / validation / fallback policy lives in the
 * provider that consumes it.
 */

export type LocalLlmConfig = {
  /** Base URL of the Ollama server, no trailing slash. */
  baseUrl: string;
  /** Installed model tag to call. */
  model: string;
  /** Hard wall-clock ceiling for a single request (ms). */
  timeoutMs: number;
  /** Sampling temperature (0 = deterministic-ish, best for structured output). */
  temperature: number;
  /** Context window to allocate (tokens). */
  numCtx: number;
  /**
   * Whether to ask a thinking-capable model to think.
   *   true  → richer reasoning, much slower
   *   false → faster, send `think:false`
   *   null  → don't send the param at all (use the model default)
   */
  think: boolean | null;
  /**
   * API dialect. "ollama" = Ollama's native /api/chat (dev default). "openai" =
   * the OpenAI-compatible /v1/chat/completions endpoint — what a PRODUCTION
   * served model (vLLM, TGI, Ollama's own /v1, or a hosted gateway) speaks. The
   * provider code is identical; only this flag + the base URL change.
   */
  apiStyle: "ollama" | "openai";
  /** Bearer token for a served/hosted endpoint. Null for local. */
  apiKey: string | null;
};

function toInt(v: string | undefined, dflt: number): number {
  if (v == null || v.trim() === "") return dflt;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function toFloat(v: string | undefined, dflt: number): number {
  if (v == null || v.trim() === "") return dflt;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * Resolve config from the environment. Defaults are tuned for a local Ollama
 * with a thinking model: a generous timeout (first call cold-loads the weights)
 * and thinking disabled for latency (flip LOCAL_LLM_THINK=true for max quality).
 */
export function resolveLocalLlmConfig(
  env: NodeJS.ProcessEnv = process.env
): LocalLlmConfig {
  const thinkRaw = env.LOCAL_LLM_THINK;
  return {
    baseUrl: (env.LOCAL_LLM_BASE_URL || "http://localhost:11434").replace(
      /\/+$/,
      ""
    ),
    model: env.LOCAL_LLM_MODEL || "qwen3.6:latest",
    timeoutMs: toInt(env.LOCAL_LLM_TIMEOUT_MS, 120_000),
    temperature: toFloat(env.LOCAL_LLM_TEMPERATURE, 0),
    numCtx: toInt(env.LOCAL_LLM_NUM_CTX, 8192),
    think: thinkRaw == null || thinkRaw.trim() === "" ? false : thinkRaw === "true",
    apiStyle: env.LLM_API_STYLE === "openai" ? "openai" : "ollama",
    apiKey: env.LLM_API_KEY && env.LLM_API_KEY.length > 0 ? env.LLM_API_KEY : null,
  };
}

export class LocalLlmError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LocalLlmError";
  }
}

export type ChatJsonArgs = {
  system: string;
  user: string;
  /** Caller-supplied cancellation, chained with the internal timeout. */
  signal?: AbortSignal;
};

type OllamaChatEnvelope = {
  message?: { role?: string; content?: string; thinking?: string };
  done?: boolean;
};

type OpenAiChatEnvelope = {
  choices?: Array<{ message?: { content?: string } }>;
};

/** Parse a JSON object out of model `content`, with a balanced-brace salvage. */
function parseJsonContent<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    const salvaged = extractJsonObject(content);
    if (salvaged) {
      try {
        return JSON.parse(salvaged) as T;
      } catch {
        /* fall through */
      }
    }
    throw new LocalLlmError("local LLM content was not valid JSON", err);
  }
}

/**
 * Pull the first balanced JSON object out of a string. Backstop for models that
 * occasionally wrap JSON in prose or code fences despite `format: "json"`.
 */
function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

export class LocalLlmClient {
  readonly config: LocalLlmConfig;

  constructor(config?: Partial<LocalLlmConfig>) {
    this.config = { ...resolveLocalLlmConfig(), ...config };
  }

  get model(): string {
    return this.config.model;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Send a chat request in JSON mode and return the parsed JSON object. Uses
   * Ollama's /api/chat (apiStyle "ollama") or the OpenAI-compatible
   * /v1/chat/completions (apiStyle "openai") — the production served path.
   * Throws `LocalLlmError` on transport failure, timeout, non-2xx, empty
   * content, or unparseable JSON.
   */
  async chatJson<T = unknown>(args: ChatJsonArgs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (args.signal) {
      if (args.signal.aborted) controller.abort();
      else args.signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      const openai = this.config.apiStyle === "openai";
      const messages = [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ];
      const body: Record<string, unknown> = openai
        ? {
            model: this.config.model,
            stream: false,
            temperature: this.config.temperature,
            response_format: { type: "json_object" },
            messages,
          }
        : {
            model: this.config.model,
            stream: false,
            format: "json",
            options: {
              temperature: this.config.temperature,
              num_ctx: this.config.numCtx,
            },
            messages,
          };
      if (!openai && this.config.think !== null) body.think = this.config.think;

      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;

      const url = openai
        ? `${this.config.baseUrl}/v1/chat/completions`
        : `${this.config.baseUrl}/api/chat`;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LocalLlmError(
          `local LLM HTTP ${res.status}: ${text.slice(0, 200)}`
        );
      }

      let content: string | undefined;
      try {
        if (openai) {
          const env = (await res.json()) as OpenAiChatEnvelope;
          content = env.choices?.[0]?.message?.content?.trim();
        } else {
          const env = (await res.json()) as OllamaChatEnvelope;
          content = env.message?.content?.trim();
        }
      } catch (err) {
        throw new LocalLlmError("local LLM returned a non-JSON envelope", err);
      }

      if (!content) {
        throw new LocalLlmError("local LLM returned empty content");
      }
      return parseJsonContent<T>(content);
    } catch (err) {
      if (err instanceof LocalLlmError) throw err;
      if ((err as { name?: string })?.name === "AbortError") {
        throw new LocalLlmError(
          `local LLM timed out after ${this.config.timeoutMs}ms`,
          err
        );
      }
      throw new LocalLlmError(
        `local LLM request failed: ${(err as Error)?.message ?? String(err)}`,
        err
      );
    } finally {
      clearTimeout(timer);
      if (args.signal) args.signal.removeEventListener("abort", onExternalAbort);
    }
  }

  /**
   * Cheap liveness probe — true if the server answers `/api/tags` promptly.
   * Used by scripts/integration tests to skip gracefully when no model server
   * is running. Never throws.
   */
  async isReachable(timeoutMs = 2500): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const path = this.config.apiStyle === "openai" ? "/v1/models" : "/api/tags";
      const headers: Record<string, string> = {};
      if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        headers,
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
