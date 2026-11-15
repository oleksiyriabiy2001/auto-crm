#!/bin/sh
# Runs on `pnpm install` (the `prepare` script). Points .git/config at the
# committed .githooks.gitconfig so every clone gets the same hooks.
set -eu

# Not a git checkout (e.g. a tarball or a Docker build): nothing to do.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Relative include paths resolve from .git/config, so step up one level.
include='../.githooks.gitconfig'
if ! git config --get-all include.path | grep -qxF "$include"; then
  git config --add include.path "$include"
fi

# Config-based hooks need Git 2.54+. Older versions ignore them silently.
version=$(git --version | sed 's/[^0-9.]*\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/')
major=${version%%.*}
minor=${version#*.}
if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 54 ]; }; then
  echo "warning: git $version found; the repo's git hooks need git 2.54 or newer." >&2
fi
