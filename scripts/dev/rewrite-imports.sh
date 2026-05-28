#!/usr/bin/env bash
# Bulk-rewrite import paths after the SDLC layering refactor.
#
# Run once. Idempotent: re-running is a no-op because every mapped source
# path no longer exists in the tree.
#
# Each sed -i '' is BSD-sed safe (macOS default). The script targets only
# .ts and .tsx files inside src/, scripts/, and instrumentation files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Files to rewrite. Include scripts/ and the few config-ish .ts files at
# the project root (vitest.setup.ts, scripts/seed.ts etc.) that import @/.
FILES=$(find src scripts -type f \( -name "*.ts" -o -name "*.tsx" \))

# Helper: portable in-place sed for macOS + GNU.
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

apply() {
  local pattern="$1"
  for f in $FILES; do
    sed_inplace -e "$pattern" "$f"
  done
}

# ── DOMAIN ───────────────────────────────────────────────────────────────
apply 's|"@/lib/risk/score"|"@server/domain/risk/score"|g'
apply 's|"@/lib/notice-deadline/calculate"|"@server/domain/notice-deadline/calculate"|g'
apply 's|"@/lib/notice-deadline/threshold"|"@server/domain/notice-deadline/threshold"|g'
apply 's|"@/lib/notice-deadline/tone"|"@server/domain/notice-deadline/tone"|g'
apply 's|"@/lib/notice-deadline/parse"|"@server/domain/notice-deadline/parse"|g'
apply 's|"@/lib/notifications/labels"|"@server/domain/notifications/labels"|g'
apply 's|"@/lib/subscriptions/status-badge"|"@server/domain/subscriptions/status-badge"|g'
apply 's|"@/lib/billing/tier-definitions"|"@server/domain/billing/tier-definitions"|g'
apply 's|"@/lib/billing/annualize"|"@server/domain/billing/annualize"|g'

# ── INFRASTRUCTURE ───────────────────────────────────────────────────────
apply 's|"@/lib/db"|"@server/infrastructure/db/client"|g'
apply 's|"@/lib/db/schema"|"@server/infrastructure/db/schema"|g'
apply 's|"@/lib/db/queries/action-queue"|"@server/infrastructure/db/repositories/action-queue"|g'
apply 's|"@/lib/db/queries/approvals"|"@server/infrastructure/db/repositories/approvals"|g'
apply 's|"@/lib/db/queries/dashboard"|"@server/infrastructure/db/repositories/dashboard"|g'
apply 's|"@/lib/db/queries/integrations"|"@server/infrastructure/db/repositories/integrations"|g'
apply 's|"@/lib/db/queries/invitations"|"@server/infrastructure/db/repositories/invitations"|g'
apply 's|"@/lib/db/queries/notice-deadlines"|"@server/infrastructure/db/repositories/notice-deadlines"|g'
apply 's|"@/lib/db/queries/notifications"|"@server/infrastructure/db/repositories/notifications"|g'
apply 's|"@/lib/db/queries/renewals"|"@server/infrastructure/db/repositories/renewals"|g'
apply 's|"@/lib/db/queries/reports"|"@server/infrastructure/db/repositories/reports"|g'
apply 's|"@/lib/db/queries/savings"|"@server/infrastructure/db/repositories/savings"|g'
apply 's|"@/lib/db/queries/subscriptions"|"@server/infrastructure/db/repositories/subscriptions"|g'
apply 's|"@/lib/db/queries/users"|"@server/infrastructure/db/repositories/users"|g'
apply 's|"@/lib/db/queries/vendors"|"@server/infrastructure/db/repositories/vendors"|g'
apply 's|"@/lib/audit/write"|"@server/infrastructure/audit-log/writer"|g'
apply 's|"@/lib/crypto/envelope"|"@server/infrastructure/crypto/envelope"|g'
apply 's|"@/lib/csv/format-helpers"|"@server/infrastructure/csv/format-helpers"|g'
apply 's|"@/lib/csv/subscriptions-format"|"@server/infrastructure/csv/subscriptions-format"|g'
apply 's|"@/lib/pdf/prep-pack"|"@server/infrastructure/pdf/prep-pack"|g'
apply 's|"@/lib/email/send"|"@server/infrastructure/email/client"|g'
apply 's|"@/emails/welcome"|"@server/infrastructure/email/templates/welcome"|g'
apply 's|"@/emails/notice-deadline-alert"|"@server/infrastructure/email/templates/notice-deadline-alert"|g'
apply 's|"@/emails/weekly-digest"|"@server/infrastructure/email/templates/weekly-digest"|g'
apply 's|"@/emails/monthly-summary"|"@server/infrastructure/email/templates/monthly-summary"|g'
apply 's|"@/emails/invitation"|"@server/infrastructure/email/templates/invitation"|g'
apply 's|"@/lib/billing/stripe"|"@server/infrastructure/billing/stripe-client"|g'
apply 's|"@/lib/billing/checkout"|"@server/infrastructure/billing/checkout"|g'
apply 's|"@/lib/billing/portal"|"@server/infrastructure/billing/portal"|g'
apply 's|"@/lib/billing/webhook"|"@server/infrastructure/billing/webhook"|g'
apply 's|"@/lib/billing/plans"|"@server/infrastructure/billing/plans"|g'

# Template-internal imports rewritten (templates moved together).
apply 's|"./_components/branded-shell"|"./_components/branded-shell"|g'

# ── APPLICATION (use cases — were "mutations") ───────────────────────────
apply 's|"@/lib/db/mutations/subscriptions"|"@server/application/subscriptions"|g'
apply 's|"@/lib/db/mutations/savings"|"@server/application/savings"|g'
apply 's|"@/lib/db/mutations/integrations"|"@server/application/integrations"|g'
apply 's|"@/lib/db/mutations/invitations"|"@server/application/invitations"|g'
apply 's|"@/lib/auth/provision"|"@server/application/auth/provision"|g'

# ── MIDDLEWARE ───────────────────────────────────────────────────────────
apply 's|"@/lib/auth/current-user"|"@server/middleware/current-user"|g'
apply 's|"@/lib/auth/rbac"|"@server/middleware/rbac"|g'
apply 's|"@/lib/demo-mode"|"@server/middleware/demo-mode"|g'

# ── JOBS ─────────────────────────────────────────────────────────────────
apply 's|"@/inngest/client"|"@server/jobs/client"|g'
apply 's|"@/inngest/functions/notice-deadline-alerts"|"@server/jobs/functions/notice-deadline-alerts"|g'
apply 's|"@/inngest/functions/renewal-event-state"|"@server/jobs/functions/renewal-event-state"|g'
apply 's|"@/inngest/functions/digests"|"@server/jobs/functions/digests"|g'
apply 's|"@/inngest/functions/slack-daily-summary"|"@server/jobs/functions/slack-daily-summary"|g'
apply 's|"@/inngest/functions/audit-retention"|"@server/jobs/functions/audit-retention"|g'

# ── UI ───────────────────────────────────────────────────────────────────
apply 's|"@/components/ui/|"@ui/components/primitives/|g'
apply 's|"@/components/layout/|"@ui/components/layout/|g'
apply 's|"@/components/shared/|"@ui/components/shared/|g'
apply 's|"@/components/action-queue/|"@ui/features/action-queue/|g'
apply 's|"@/components/approvals/|"@ui/features/approvals/|g'
apply 's|"@/components/dashboard/|"@ui/features/dashboard/|g'
apply 's|"@/components/decide-now/|"@ui/features/decide-now/|g'
apply 's|"@/components/marketing/|"@ui/features/marketing/|g'
apply 's|"@/components/notice-deadlines/|"@ui/features/notice-deadlines/|g'
apply 's|"@/components/onboarding/|"@ui/features/onboarding/|g'
apply 's|"@/components/renewals/|"@ui/features/renewals/|g'
apply 's|"@/components/settings/|"@ui/features/settings/|g'
apply 's|"@/components/subscriptions/|"@ui/features/subscriptions/|g'
apply 's|"@/hooks/use-toast"|"@ui/hooks/use-toast"|g'

# ── SHARED ───────────────────────────────────────────────────────────────
apply 's|"@/lib/validation/account"|"@shared/validation/account"|g'
apply 's|"@/lib/validation/subscription"|"@shared/validation/subscription"|g'
apply 's|"@/lib/utils"|"@shared/utils"|g'
apply 's|"@/lib/utils/group-by-month"|"@shared/utils/group-by-month"|g'

echo "imports rewritten"
