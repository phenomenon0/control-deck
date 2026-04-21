#!/usr/bin/env bash
# Attach browser-harness to a running Control Deck Electron process.
#
# Usage:
#   CONTROL_DECK_DEVTOOLS_PORT=9223 bun run electron:dev     # launch the deck with CDP on
#   ./scripts/attach-harness.sh <<'PY'                        # attach + run python
#     print(page_info())
#     screenshot("/tmp/deck.png")
#   PY
#
# Env:
#   CONTROL_DECK_DEVTOOLS_PORT   CDP port (default 9223)
#   BU_NAME                      Harness daemon name (default control-deck)
#   BROWSER_HARNESS_BIN          Override the browser-harness command
#                                (default: browser-harness on $PATH)
#
# Any args passed to this script are forwarded to browser-harness verbatim.
# Stdin is forwarded too — the heredoc pattern above is the usual call.

set -euo pipefail

PORT="${CONTROL_DECK_DEVTOOLS_PORT:-9223}"
NAME="${BU_NAME:-control-deck}"
BIN="${BROWSER_HARNESS_BIN:-browser-harness}"

if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "error: '$BIN' not on PATH — install browser-harness or set BROWSER_HARNESS_BIN" >&2
  exit 127
fi

JSON=$(curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/json/version" 2>/dev/null || true)
if [[ -z "$JSON" ]]; then
  echo "error: no CDP endpoint at http://127.0.0.1:${PORT}/json/version" >&2
  echo "       launch Control Deck with CONTROL_DECK_DEVTOOLS_PORT=${PORT} first" >&2
  exit 1
fi

WS=$(printf '%s' "$JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["webSocketDebuggerUrl"])' 2>/dev/null || true)
if [[ -z "$WS" ]]; then
  echo "error: could not extract webSocketDebuggerUrl from /json/version response" >&2
  echo "       raw: $JSON" >&2
  exit 1
fi

export BU_CDP_WS="$WS"
export BU_NAME="$NAME"

exec "$BIN" "$@"
