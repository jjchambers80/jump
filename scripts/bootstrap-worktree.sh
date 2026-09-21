#!/usr/bin/env bash
# Make a fresh git worktree runnable: copy the gitignored env files from the
# primary checkout, install workspaces and generate the Prisma client.
#
# Usage, from inside the worktree:  ./scripts/bootstrap-worktree.sh
#
# Kanban workers land in <repo>/.worktrees/<task-id>; without backend/.env the
# test suite falls back to postgres:postgres@localhost:5432 and every contract
# test fails with P1000 (docs/development/kanban-workflow.md).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
common="$(git -C "$here" rev-parse --git-common-dir)"
primary="$(cd "$(dirname "$common")" && pwd)"

if [ "$primary" = "$here" ]; then
  echo "bootstrap-worktree: already in the primary checkout ($here); nothing to copy" >&2
else
  for f in backend/.env frontend/.env.local packages/db/.env; do
    if [ -f "$here/$f" ]; then
      echo "keep    $f"
    elif [ -f "$primary/$f" ]; then
      cp "$primary/$f" "$here/$f" && echo "copied  $f  (from $primary)"
    else
      echo "missing $f in $primary — set it up by hand" >&2
    fi
  done
fi

cd "$here"
npm install --no-audit --no-fund
npm run db:generate
echo "bootstrap-worktree: ready — backend tests use $(grep -m1 '^DATABASE_URL' backend/.env 2>/dev/null | sed -E 's#://[^@]*@#://***@#') with the db name swapped to jump_test"
