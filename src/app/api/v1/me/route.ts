/**
 * GET /api/v1/me — return the account associated with the calling API key.
 * Useful as a "does my key work" smoke test for integrators.
 */
import { NextResponse } from "next/server";
import { requireApiAuth } from "@server/middleware/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiAuth({
    request,
    requiredScope: "subscriptions:read",
    action: "me.get",
  });
  if (!auth.ok) return auth.response;

  const { account, apiKey } = auth.context;
  return NextResponse.json({
    account: {
      id: account.id,
      name: account.name,
      planTier: account.planTier,
    },
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopesJson,
      keyPrefix: apiKey.keyPrefix,
    },
  });
}
