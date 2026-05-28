# `src/server/middleware/`

Cross-cutting concerns that every server action / route handler invokes before its main logic. Despite the name, these are **not** Next.js edge middleware — that's `src/middleware.ts` at the root, which is a different concept.

| File | What it does |
|---|---|
| `current-user.ts` | Resolves the authenticated Clerk session into `{account, user}` from our DB. Cached per request. Falls back to the seeded demo user when `isDemoMode`. |
| `rbac.ts` | `requireRole(user, "admin")` + `hasRole()` helpers. Throws `ForbiddenError` on a role mismatch; callers translate to a user-facing error. |
| `demo-mode.ts` | The double-guarded `isDemoMode` flag + the pinned demo account/user UUIDs. |

Every server action follows the same shape:

```ts
"use server";
export async function fooAction(...) {
  const { account, user } = await getCurrentAccountAndUser();
  try { requireRole(user, "member"); } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, formError: err.message };
    throw err;
  }
  // ... call into @server/application/* ...
}
```
