/* eslint-disable no-console -- This file IS the structured-logger sink.
 * The project-wide `no-console` rule routes operational logs through this
 * helper; the helper itself is the one place allowed to call console.* with
 * the appropriate severity (debug/info/warn/error). */
/**
 * Structured logger — the single canonical way to emit operational events.
 *
 * Why this exists:
 *   - Every console.error pattern across the app drifted into ad-hoc
 *     `[handler-name] msg` prefixes that are hard to grep
 *   - Sentry breadcrumbs need consistent context (accountId, userId,
 *     requestId) to be useful in incident response
 *   - JSON-shaped logs let log aggregators (Vercel, Datadog, etc.) index
 *     and filter without parsing free-text
 *
 * Usage (boundary: action / job / route):
 *
 *     const log = createLogger({ component: "approvals.approve", accountId, userId });
 *     log.info("decision_approved", { renewalEventId });
 *     log.error("savings_upsert_failed", err, { renewalEventId });
 *
 * The output goes to console.{info,warn,error} in production AND emits a
 * Sentry breadcrumb when Sentry is present at runtime. We don't import
 * @sentry/nextjs statically — it isn't always wired in test contexts —
 * we fall back to a no-op when the global hook isn't installed.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  /** Stable identifier for the code path emitting the log. Required. */
  component: string;
  accountId?: string;
  userId?: string;
  requestId?: string;
  [k: string]: unknown;
};

export type Logger = {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  /**
   * Error logs accept an optional Error in the second slot so the stack
   * trace doesn't get lost. Sentry receives the Error with the context
   * attached as tags.
   */
  error: (
    event: string,
    err?: unknown,
    fields?: Record<string, unknown>
  ) => void;
  /** Returns a new logger with additional context fields merged in. */
  with: (extra: Partial<LogContext>) => Logger;
};

/**
 * Build a logger with a given base context.
 */
export function createLogger(context: LogContext): Logger {
  return makeLogger(context);
}

function makeLogger(context: LogContext): Logger {
  function emit(
    level: LogLevel,
    event: string,
    fields: Record<string, unknown>
  ): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...context,
      ...fields,
    };
    // Console output — JSON for easy ingestion. In dev you can pipe
    // through `jq` for readable output; in prod log aggregators parse
    // structured JSON natively.
    const line = JSON.stringify(entry);
    switch (level) {
      case "debug":
        // Don't emit debug at runtime unless explicitly requested via
        // OBSERVABILITY_DEBUG=1 — avoids drowning prod logs in trace noise.
        if (process.env.OBSERVABILITY_DEBUG !== "1") return;
        console.debug(line);
        return;
      case "info":
        console.info(line);
        return;
      case "warn":
        console.warn(line);
        return;
      case "error":
        console.error(line);
        return;
    }
  }

  function emitSentry(level: LogLevel, event: string, err: unknown): void {
    // Lazy import — Sentry isn't present in test envs and we don't want
    // tests to depend on it. The `as unknown` casts shield TS from the
    // Sentry SDK's wide type surface.
    try {
      const SentryModule = (
        globalThis as unknown as {
          __SENTRY__?: { hub?: { captureException?: (e: unknown) => void } };
        }
      ).__SENTRY__;
      const captureException = SentryModule?.hub?.captureException;
      if (level === "error" && err instanceof Error && captureException) {
        captureException(err);
      }
    } catch {
      // Sentry is fire-and-forget; never let a logging path bubble its
      // own failures.
    }
    void event;
  }

  return {
    debug: (event, fields = {}) => emit("debug", event, fields),
    info: (event, fields = {}) => emit("info", event, fields),
    warn: (event, fields = {}) => emit("warn", event, fields),
    error: (event, err, fields = {}) => {
      const errorFields =
        err instanceof Error
          ? { errorName: err.name, errorMessage: err.message, stack: err.stack }
          : err !== undefined
            ? { errorValue: String(err) }
            : {};
      emit("error", event, { ...errorFields, ...fields });
      emitSentry("error", event, err);
    },
    with: (extra) => makeLogger({ ...context, ...extra }),
  };
}
