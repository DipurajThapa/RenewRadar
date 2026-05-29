"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  API_KEY_SCOPES,
  ApiKeyError,
  createApiKey,
  revokeApiKey,
  type ApiKeyScope,
} from "@server/application/api-keys";

export type CreateKeyResult =
  | { ok: true; rawKey: string; keyPrefix: string; name: string }
  | { ok: false; formError: string };

export async function createApiKeyAction(input: {
  name: string;
  scopes: ApiKeyScope[];
}): Promise<CreateKeyResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    // Only owner/admin can mint keys — keys can read or modify everything.
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, formError: err.message };
    throw err;
  }
  // Defensive scope coercion — guard against payload-tampering.
  const allowed = new Set<string>(API_KEY_SCOPES);
  for (const s of input.scopes) {
    if (!allowed.has(s)) {
      return { ok: false, formError: `Unknown scope: ${s}` };
    }
  }
  try {
    const r = await createApiKey({
      accountId: account.id,
      createdByUserId: user.id,
      name: input.name,
      scopes: input.scopes,
    });
    revalidatePath("/settings/api-keys");
    return {
      ok: true,
      rawKey: r.rawKey,
      keyPrefix: r.row.keyPrefix,
      name: r.row.name,
    };
  } catch (err) {
    if (err instanceof ApiKeyError) return { ok: false, formError: err.message };
    throw err;
  }
}

export type RevokeKeyResult = { ok: boolean; error?: string };

export async function revokeApiKeyAction(
  apiKeyId: string
): Promise<RevokeKeyResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  const r = await revokeApiKey({
    accountId: account.id,
    apiKeyId,
    revokedByUserId: user.id,
  });
  if (!r) return { ok: false, error: "API key not found." };
  revalidatePath("/settings/api-keys");
  return { ok: true };
}
