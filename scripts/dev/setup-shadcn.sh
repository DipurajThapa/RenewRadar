#!/usr/bin/env bash
# Adds the rest of the shadcn/ui primitives we'll need across V1 and V1.5.
# Run once after `pnpm install`.
#
# Why a script vs. manual files: shadcn's CLI is the canonical source — using
# `add` keeps you on whatever version of each component the shadcn team ships,
# and the CLI takes care of dependencies.
set -euo pipefail

# Primitives we've already created manually:
#   button, card, input, label, badge, avatar
#
# These are added via the CLI:
COMPONENTS=(
  dropdown-menu
  dialog
  select
  tabs
  toast
  form
  table
  separator
  toaster
)

echo "Adding $(echo ${#COMPONENTS[@]}) shadcn components..."
pnpm dlx shadcn@latest add "${COMPONENTS[@]}" --yes --overwrite

echo "Done. Run pnpm typecheck to confirm everything compiles."
