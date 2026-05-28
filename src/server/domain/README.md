# `src/server/domain/`

Pure business types, value objects, and invariants. No I/O. No framework imports. Trivially unit-testable.

If you reach for `db`, `fetch`, `process.env`, or `new Date()` (without making it injectable), you're in the wrong layer — move it to `application/` or `infrastructure/`.

Today this layer holds:

| File | What it computes |
|---|---|
| `billing/tier-definitions.ts` | Canonical pricing tiers, limits, feature matrix |
| `billing/annualize.ts` | `annualizeCents(cents, cycle)` pure helper |
| `notice-deadline/calculate.ts` | `calculateNoticeDeadline()`, `daysUntilNoticeDeadline()` |
| `notice-deadline/threshold.ts` | Threshold → trigger enum mapping |
| `notice-deadline/tone.ts` | Urgency-level → tailwind class mapping |
| `notice-deadline/parse.ts` | "30 days" → 30 |
| `notifications/labels.ts` | Trigger labels + pref resolution |
| `risk/score.ts` | 0–100 risk score from urgency × value × clause pressure |
| `subscriptions/status-badge.ts` | Status enum → badge variant |
