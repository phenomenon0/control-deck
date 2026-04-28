#!/usr/bin/env bash
set -euo pipefail
cd /home/omen/Documents/INIT/control-deck
exec /home/omen/.bun/bin/bun run mcp:stdio
