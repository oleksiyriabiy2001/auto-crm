#!/bin/sh
# Lints the staged files that ESLint covers. Fast, no autofix: run `pnpm lint:fix` to fix.
# Note: ESLint reads the working-tree version of each file, not the staged one.
set -eu
. "$(dirname "$0")/hook-env.sh"

git diff --cached --name-only --diff-filter=ACMR -z -- '*.ts' '*.mts' '*.vue' '*.json' \
  | xargs -0 -r pnpm exec eslint --cache --max-warnings 0 --no-warn-ignored
