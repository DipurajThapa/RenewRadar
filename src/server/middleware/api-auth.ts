/**
 * T4.6 — Public API auth middleware.
 *
 * Resolves the `Authorization: Bearer rr_pk_...` header to an account +
 * api key row. Returns a Response on failure (so the route can `return`
 * directly), or the authenticated context on success.
 *
 * Audit logging is the caller's responsibility — we record the
 * authenticated key id back to the route so it can log the request with
 * its action label.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable, type Account } from "@server/infrastructure/db/schema";
import {
  hasScope,
  verifyApiKey,
  type ApiKeyScope,
} from "@server/application/api-keys";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { getRateLimit } from "@server/infrastructure/rate-limit";
import type { ApiKey } from "@server/infrastructure/db/schema";

/** Per-API-key budget — 60 requests per 60 seconds (1 rps sustained). */
export const API_RATE_POLICY = { limit: 60, windowSeconds: 60 } as const;

export type ApiAuthContext = {
  account: Account;
  apiKey: ApiKey;
};

export type ApiAuthResult =
  | { ok: true; context: ApiAuthContext }
  | { ok: false; response: Response };

function unauthorized(message: string): Response {
  return NextResponse.json(
    { error: "unauthorized", message },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
  );
}

function forbidden(message: string): Response {
  return NextResponse.json({ error: "forbidden", message }, { status: 403 });
}

/**
 * Parse the bearer token, verify it, load the account, and enforce the
 * scope + rate limit. The caller passes `requiredScope` so the gate is
 * declarative per endpoint.
 */
export async function requireApiAuth(args: {
  request: Request;
  requiredScope: ApiKeyScope;
  /**
   * Human label that goes into the api.request audit entry. Should match
   * the OpenAPI operationId so it grep's cleanly.
   */
  action: string;
}): Promise<ApiAuthResult> {
  const header = args.request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(rr_pk_[a-f0-9]{32})$/i.exec(header);
  if (!m) {
    return {
      ok: false,
      response: unauthorized(
        "Provide a bearer token: `Authorization: Bearer rr_pk_…`."
      ),
    };
  }
  const raw = m[1]!;

  const verify = await verifyApiKey(raw);
  if (!verify.ok) {
    return { ok: false, response: unauthorized("Invalid or revoked API key.") };
  }
  const apiKey = verify.apiKey;

  if (!hasScope(apiKey, args.requiredScope)) {
    return {
      ok: false,
      response: forbidden(
        `This key does not have the \`${args.requiredScope}\` scope.`
      ),
    };
  }

  // Per-key rate limit. Window is short so the response carries a precise
  // retry-after.
  const rl = await getRateLimit().check(`api:${apiKey.id}`, API_RATE_POLICY);
  if (!rl.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "rate_limited", message: "Too many requests for this API key." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(rl.resetSeconds))),
          },
        }
      ),
    };
  }

  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, apiKey.accountId))
    .limit(1);
  if (!account) {
    return {
      ok: false,
      response: unauthorized("Account no longer exists for this API key."),
    };
  }

  // Audit the API request. Fire-and-forget so a hot-path slow log writer
  // never blocks a 200.
  void writeAuditLog(db, {
    accountId: apiKey.accountId,
    actorUserId: null,
    action: AUDIT_ACTIONS.apiRequest,
    target: { entityType: "api_key", entityId: apiKey.id },
    after: {
      action: args.action,
      method: args.request.method,
      path: new URL(args.request.url).pathname,
      scopes: apiKey.scopesJson,
    },
  }).catch(() => undefined);

  return { ok: true, context: { account, apiKey } };
}
