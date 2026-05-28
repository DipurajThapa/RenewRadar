# `tests/`

Cross-cutting test suites that don't co-locate with the code they exercise.

| Folder | What goes here |
|---|---|
| `e2e/` | Playwright end-to-end suites — full user journeys against a running dev server |
| `fixtures/` | Shared test data: canned CSVs, sample PDFs, fixture rows |

## What's NOT here

- **Unit and integration tests** live next to the code they test, under `src/**/__tests__/*.test.ts`. This pattern was inherited from the canonical tenant-isolation suite and works well for a codebase this size.
- **Contract tests** don't exist as a separate category — TypeScript across the server-action boundary _is_ the contract. When we publish a public REST/GraphQL API, contract tests land in `tests/contract/`.

## E2E status

Phase E exits with the smoke-test happy path: sign up → add subscription → view action queue → log a decision → see savings record. The scaffold below is the start of that suite.

```bash
# Future:
pnpm test:e2e            # runs Playwright against dev server
pnpm test:e2e:headed     # same, with browser visible
```

Not wired in CI yet.
