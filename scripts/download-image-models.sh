#!/usr/bin/env bash
# The path every missing-weights hint has always pointed at — now real.
# Thin wrapper over the TS implementation so the catalog stays single-source.
#   scripts/download-image-models.sh <preset...> | --all | --list
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun run scripts/download-weights.ts "$@"
