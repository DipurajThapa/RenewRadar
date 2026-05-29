/**
 * T4.6 — Public API route tests.
 *
 * Pins the auth + scope + cross-account contract for every v1 endpoint.
 * These are the load-bearing tests that prove a leaked / wrong-account /
 * insufficient-scope key cannot read or modify customer data.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { subscriptionsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { createApiKey } from "@server/application/api-keys";
import { _resetRateLimitForTests } from "@server/infrastructure/rate-limit";

import { GET as getMe } from "@app/api/v1/me/route";
import {
  GET as listSubs,
  POST as createSub,
} from "@app/api/v1/subscriptions/route";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  // Fresh rate limiter per test so a previous test's 60-req burn doesn't
  // taint the next one.
  _resetRateLimitForTests();
});

async function key(scopes: ("subscriptions:read" | "subscriptions:write")[]) {
  return createApiKey({
    accountId: ids.accountA.id,
    createdByUserId: ids.accountA.userId,
    name: `test key (${scopes.join(",")})`,
    scopes,
  });
}

function req(args: {
  method: "GET" | "POST";
  path: string;
  authorization?: string;
  body?: unknown;
}): Request {
  return new Request(`http://localhost${args.path}`, {
    method: args.method,
    headers: {
      ...(args.authorization
        ? { Authorization: args.authorization }
        : {}),
      "Content-Type": "application/json",
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Auth gate
// ─────────────────────────────────────────────────────────────────────────

describe("auth gate", () => {
  it("returns 401 for missing Authorization header", async () => {
    const res = await getMe(req({ method: "GET", path: "/api/v1/me" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for malformed bearer token", async () => {
    const res = await getMe(
      req({
        method: "GET",
        path: "/api/v1/me",
        authorization: "Bearer not-a-key",
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown but well-shaped key", async () => {
    const res = await getMe(
      req({
        method: "GET",
        path: "/api/v1/me",
        authorization: "Bearer rr_pk_" + "0".repeat(32),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when the key lacks the required scope", async () => {
    // Read-only key cannot POST.
    const { rawKey } = await key(["subscriptions:read"]);
    const res = await createSub(
      req({
        method: "POST",
        path: "/api/v1/subscriptions",
        authorization: `Bearer ${rawKey}`,
        body: { vendor: "x", product: "y" },
      })
    );
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /me
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/me", () => {
  it("returns the account associated with the key", async () => {
    const { rawKey, row } = await key(["subscriptions:read"]);
    const res = await getMe(
      req({
        method: "GET",
        path: "/api/v1/me",
        authorization: `Bearer ${rawKey}`,
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      account: { id: string };
      apiKey: { id: string; scopes: string[] };
    };
    expect(json.account.id).toBe(ids.accountA.id);
    expect(json.apiKey.id).toBe(row.id);
    expect(json.apiKey.scopes).toContain("subscriptions:read");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /subscriptions
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/subscriptions", () => {
  it("returns only this account's subscriptions, never leaking another's", async () => {
    const { rawKey } = await key(["subscriptions:read"]);
    const res = await listSubs(
      req({
        method: "GET",
        path: "/api/v1/subscriptions",
        authorization: `Bearer ${rawKey}`,
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };

    // Only A's seed subscription should appear; B's is NOT in the list.
    expect(json.data.length).toBe(1);
    expect(json.data[0]!.id).toBe(ids.accountA.subscriptionId);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /subscriptions
// ─────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/subscriptions", () => {
  it("creates a subscription bound to the calling account", async () => {
    const { rawKey } = await key(["subscriptions:write"]);
    const res = await createSub(
      req({
        method: "POST",
        path: "/api/v1/subscriptions",
        authorization: `Bearer ${rawKey}`,
        body: {
          vendor: "Linear",
          product: "Standard",
          billingCycle: "annual",
          termStartDate: "2026-01-01",
          termEndDate: "2027-01-01",
          autoRenew: true,
          noticePeriodDays: 30,
          totalSeats: 10,
          unitPriceCents: 10000,
        },
      })
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string };

    // The new row exists in A's account.
    const [row] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, json.id));
    expect(row?.accountId).toBe(ids.accountA.id);
    expect(row?.productName).toBe("Standard");
  });

  it("returns 422 on invalid payload (missing fields)", async () => {
    const { rawKey } = await key(["subscriptions:write"]);
    const res = await createSub(
      req({
        method: "POST",
        path: "/api/v1/subscriptions",
        authorization: `Bearer ${rawKey}`,
        body: { vendor: "Linear" },
      })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_payload");
  });

  it("returns 400 on invalid JSON body", async () => {
    const { rawKey } = await key(["subscriptions:write"]);
    const r = new Request("http://localhost/api/v1/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rawKey}`,
        "Content-Type": "application/json",
      },
      body: "{not json",
    });
    const res = await createSub(r);
    expect(res.status).toBe(400);
  });
});
