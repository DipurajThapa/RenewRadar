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

`src/ui/**` is **not allowed** to import from `@server/*`. The TypeScript bundler will refuse it because server code imports browser-incompatible packages (`node:crypto`, `drizzle-orm`, `postgres`, etc.) — but the explicit boundary makes the rule auditable rather than accidental.

A page that needs server data and UI imports both: it's a server component that calls into `@server/...` for the data and renders `@ui/...` components with the result.
