#!/usr/bin/env bash
# Build the macOS AX helper binary and stage it next to the other helpers.
#
# Called from scripts/copy-native-binaries.cjs during electron:pack on darwin
# hosts, and invokable directly during dev to iterate on the Swift sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$HERE/macos-ax-helper"
OUT="$HERE/macos-ax-helper.bin"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "[build-macos-helper] skipping — host is not darwin" >&2
    exit 0
fi

if ! command -v swift >/dev/null 2>&1; then
    echo "[build-macos-helper] swift not found on PATH (install Xcode Command Line Tools)" >&2
    exit 1
fi

echo "[build-macos-helper] building $PKG"
(cd "$PKG" && swift build -c release)

BUILT="$PKG/.build/release/macos-ax-helper"
if [[ ! -x "$BUILT" ]]; then
    echo "[build-macos-helper] expected binary not produced: $BUILT" >&2
    exit 1
fi

cp "$BUILT" "$OUT"
chmod 0755 "$OUT"
echo "[build-macos-helper] wrote $OUT"
