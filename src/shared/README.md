# `src/shared/`

The only code path that is safe in both the browser bundle and the server bundle.

| Subfolder | What it owns |
|---|---|
| `validation/` | Zod schemas shared by the server action (validates) and the client form (displays field errors). |
| `utils/` | Pure functions used by both sides: `cn()`, `formatCurrency`, `formatDate`, `daysUntil`, `groupByMonth`. |
| `types/` | Types not tied to either side (empty today; reserved for OpenAPI-derived types when we publish a public API). |

`src/shared/**` **cannot** import from `@server/*` or `@ui/*`. If it did, every page that touched a shared util would drag the database client into the browser bundle (or the React DOM into the Node bundle). The bundler would catch most of these eventually; the constraint here makes the failure obvious at lint time.

A shared utility's job is to be small, pure, and obviously correct. If you need to reach for `process.env` or `fetch`, you're in the wrong layer.
