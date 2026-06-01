/**
 * LocalLlmClient transport — both API dialects (Ollama native + OpenAI-compatible
 * served), config resolution, and error handling. Offline (mocked fetch).
 *
 * The OpenAI path is the PRODUCTION serving path: a vLLM/TGI/hosted endpoint is a
 * config swap (LLM_API_STYLE=openai + LLM_API_BASE + LLM_API_KEY), no code change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalLlmClient,
  LocalLlmError,
  resolveLocalLlmConfig,
} from "../client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function okJson(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload, text: async () => "" };
}

describe("resolveLocalLlmConfig", () => {
  it("defaults to the ollama dialect with no key", () => {
    const c = resolveLocalLlmConfig({} as NodeJS.ProcessEnv);
    expect(c.apiStyle).toBe("ollama");
    expect(c.apiKey).toBeNull();
  });

  it("reads LLM_API_STYLE + LLM_API_KEY", () => {
    const c = resolveLocalLlmConfig({
      LLM_API_STYLE: "openai",
      LLM_API_KEY: "sk-test",
    } as unknown as NodeJS.ProcessEnv);
    expect(c.apiStyle).toBe("openai");
    expect(c.apiKey).toBe("sk-test");
  });
});

describe("chatJson — ollama dialect", () => {
  it("posts to /api/chat with format:json and parses message.content", async () => {
    fetchMock.mockResolvedValue(okJson({ message: { content: '{"y":2}' } }));
    const client = new LocalLlmClient({ apiStyle: "ollama", baseUrl: "http://localhost:11434" });
    expect(await client.chatJson({ system: "s", user: "u" })).toEqual({ y: 2 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(JSON.parse((init as RequestInit).body as string).format).toBe("json");
  });

  it("salvages JSON wrapped in prose", async () => {
    fetchMock.mockResolvedValue(okJson({ message: { content: 'Here you go: {"z":3} thanks' } }));
    const client = new LocalLlmClient({ apiStyle: "ollama" });
    expect(await client.chatJson({ system: "s", user: "u" })).toEqual({ z: 3 });
  });
});

describe("chatJson — openai dialect (production serving path)", () => {
  it("posts to /v1/chat/completions with auth + response_format, parses choices", async () => {
    fetchMock.mockResolvedValue(
      okJson({ choices: [{ message: { content: '{"x":1}' } }] })
    );
    const client = new LocalLlmClient({
      apiStyle: "openai",
      apiKey: "sk-test",
      baseUrl: "https://served.example",
    });
    expect(await client.chatJson({ system: "s", user: "u" })).toEqual({ x: 1 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://served.example/v1/chat/completions");
    const i = init as RequestInit & { headers: Record<string, string> };
    expect(i.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(i.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.format).toBeUndefined(); // ollama-only field absent
  });
});

describe("chatJson — errors", () => {
  it("throws LocalLlmError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" });
    await expect(
      new LocalLlmClient().chatJson({ system: "s", user: "u" })
    ).rejects.toBeInstanceOf(LocalLlmError);
  });

  it("throws LocalLlmError on empty content", async () => {
    fetchMock.mockResolvedValue(okJson({ message: { content: "" } }));
    await expect(
      new LocalLlmClient({ apiStyle: "ollama" }).chatJson({ system: "s", user: "u" })
    ).rejects.toBeInstanceOf(LocalLlmError);
  });
});
