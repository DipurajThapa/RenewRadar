# `src/ui/`

All React code — both client components (`"use client"`) and server components used as UI building blocks.

| Subfolder | What it owns |
|---|---|
| `components/primitives/` | Atomic UI from shadcn/ui (button, input, dialog, select, …). No business meaning. |
| `components/layout/` | The app shell — top nav, side nav, demo banner, notification bell. |
| `components/shared/` | Generic UI used by many features — empty state, urgency pill, FAQ item. |
| `features/<feature>/` | Feature-scoped components — one folder per business capability (subscriptions, action-queue, settings, dashboard, etc.). |
| `hooks/` | Browser-only React hooks (currently just `use-toast`). |
| `design-system/` | Design tokens, theme variables (placeholder today; expands when we ship a real design system). |

`src/ui/**` is allowed to import from `@server/*` only along these specific paths (see [layers.md](../../docs/architecture/layers.md) for the full matrix):

- **`@server/domain/*`** — pure modules (no I/O), bundle-safe in either runtime.
- **`@server/application/*` via `"use server"`** — server actions; Next.js handles them as RPC, no server code reaches the client bundle.
- **`@server/infrastructure/db/{schema,repositories}` as `import type` only** —
  TypeScript erases type-only imports; the bundle is clean.
- **`@server/middleware/demo-mode`** — the `isDemoMode` constant only.

All other paths into `@server/*` from UI are forbidden because they would drag
`postgres`, `node:crypto`, `resend`, or the Stripe SDK into the browser bundle.
The bundler will error before it ships; the rule documents the intent.

A page that needs server data and UI imports both: it's a server component
that calls into `@server/...` for the data and renders `@ui/...` components
with the result.
