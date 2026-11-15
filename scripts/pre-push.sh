#!/bin/sh
# Full type-check and unit tests before anything leaves the machine.
set -eu
. "$(dirname "$0")/hook-env.sh"

pnpm type-check
pnpm test
