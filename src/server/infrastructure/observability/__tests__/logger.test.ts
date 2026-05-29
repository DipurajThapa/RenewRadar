/**
 * Structured logger tests — pin the wire format and the context-merge
 * behaviour so log aggregators (Vercel, Datadog, etc.) can rely on the
 * schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@server/infrastructure/observability/logger";

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let debugSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  infoSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  debugSpy.mockRestore();
});

function lastJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const calls = spy.mock.calls;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) throw new Error("no logger call captured");
  return JSON.parse(lastCall[0] as string) as Record<string, unknown>;
}

describe("createLogger basic shape", () => {
  it("emits info as structured JSON with required fields", () => {
    const log = createLogger({ component: "test.handler" });
    log.info("widget_created", { widgetId: "abc" });
    const entry = lastJson(infoSpy);
    expect(entry.level).toBe("info");
    expect(entry.event).toBe("widget_created");
    expect(entry.component).toBe("test.handler");
    expect(entry.widgetId).toBe("abc");
    expect(typeof entry.ts).toBe("string");
  });

  it("warn/error route to console.warn/console.error", () => {
    const log = createLogger({ component: "test" });
    log.warn("slow_query", { ms: 1200 });
    log.error("oops", new Error("boom"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("error attaches the Error name/message/stack when present", () => {
    const log = createLogger({ component: "test" });
    const err = new Error("hash collision");
    err.name = "CryptoError";
    log.error("decrypt_failed", err, { rowId: "row-1" });
    const entry = lastJson(errorSpy);
    expect(entry.event).toBe("decrypt_failed");
    expect(entry.errorName).toBe("CryptoError");
    expect(entry.errorMessage).toBe("hash collision");
    expect(entry.rowId).toBe("row-1");
    expect(typeof entry.stack).toBe("string");
  });

  it("error tolerates non-Error error values", () => {
    const log = createLogger({ component: "test" });
    log.error("string_err", "raw string err", { foo: "bar" });
    const entry = lastJson(errorSpy);
    expect(entry.errorValue).toBe("raw string err");
    expect(entry.foo).toBe("bar");
  });
});

describe("createLogger context merging via .with()", () => {
  it(".with() returns a new logger that inherits + adds fields", () => {
    const root = createLogger({
      component: "api.documents",
      accountId: "acct-1",
    });
    const scoped = root.with({ userId: "user-1", requestId: "req-9" });
    scoped.info("upload_started", { docId: "doc-1" });
    const entry = lastJson(infoSpy);
    expect(entry.component).toBe("api.documents");
    expect(entry.accountId).toBe("acct-1");
    expect(entry.userId).toBe("user-1");
    expect(entry.requestId).toBe("req-9");
    expect(entry.docId).toBe("doc-1");
  });

  it(".with() does not mutate the parent logger", () => {
    const root = createLogger({ component: "root" });
    root.with({ userId: "user-1" });
    root.info("no_user");
    const entry = lastJson(infoSpy);
    expect(entry.userId).toBeUndefined();
  });

  it("per-call fields override context fields when keys collide", () => {
    const root = createLogger({ component: "test", accountId: "ctx-acct" });
    root.info("override", { accountId: "call-acct" });
    const entry = lastJson(infoSpy);
    expect(entry.accountId).toBe("call-acct");
  });
});

describe("debug suppression", () => {
  it("debug emits nothing without OBSERVABILITY_DEBUG=1", () => {
    delete process.env.OBSERVABILITY_DEBUG;
    const log = createLogger({ component: "test" });
    log.debug("noisy", { detail: "spam" });
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("debug emits when OBSERVABILITY_DEBUG=1", () => {
    process.env.OBSERVABILITY_DEBUG = "1";
    try {
      const log = createLogger({ component: "test" });
      log.debug("noisy", { detail: "spam" });
      expect(debugSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.OBSERVABILITY_DEBUG;
    }
  });
});
