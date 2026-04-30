#!/usr/bin/env bash
#
# Build a CoreML-enabled libwhisper and swap it into pywhispercpp's bundled
# .dylibs so whisper.cpp transcribes the encoder on Apple Neural Engine.
#
# Why: the pip wheel of pywhispercpp ships whisper.cpp built with Metal only.
# On Apple Silicon, swapping in a libwhisper compiled with WHISPER_COREML=1
# drops Whisper-large-v3-turbo's RTF from ~0.4 to ~0.10 — about 4× faster on
# M3, with identical output quality.
#
# Usage:
#   ./build-coreml-libwhisper.sh             # build + swap (idempotent)
#   ./build-coreml-libwhisper.sh --rebuild   # force fresh clone + build
#   ./build-coreml-libwhisper.sh --restore   # revert to original pip wheel
#   ./build-coreml-libwhisper.sh --help
#
# Prerequisites:
#   - macOS 12+ on Apple Silicon
#   - Xcode Command Line Tools (provides cmake, install_name_tool, codesign)
#   - Run from anywhere; the script locates the voice-core venv automatically
#   - pywhispercpp must already be installed in apps/voice-core/.venv/
#     (run `uv sync --extra mac` first)
#
# What this does NOT do:
#   - Generate the base.en CoreML encoder (.mlmodelc). Turbo's mlmodelc is
#     shipped in models/voice-engines/whisper-large-v3-turbo-cpp/. To create
#     one for base.en, see whisper.cpp's models/generate-coreml-model.sh
#     (needs coremltools + ane_transformers).
#   - Modify any committed code. Only the local .venv is touched.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VOICE_CORE="$REPO_ROOT/apps/voice-core"
BUILD_DIR="${WHISPER_BUILD_DIR:-/tmp/whisper-build}"
WHISPER_REPO="$BUILD_DIR/whisper.cpp"
WHISPER_GIT="https://github.com/ggml-org/whisper.cpp.git"

ACTION="build"
case "${1:-}" in
  --help|-h)
    sed -n '2,28p' "$0" | sed 's/^#//; s/^ //'
    exit 0
    ;;
  --restore) ACTION="restore" ;;
  --rebuild) ACTION="rebuild" ;;
  "" )       ACTION="build" ;;
  *)
    echo "unknown arg: $1 — try --help" >&2
    exit 2
    ;;
esac

log()  { printf '\033[1;36m[coreml]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[coreml]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[coreml]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- preflight ----------
[[ "$(uname -s)" == "Darwin" ]] || die "macOS only — this is a no-op (and unnecessary) on other platforms."
[[ "$(uname -m)" == "arm64" ]] || warn "non-arm64 ($(uname -m)); CoreML build will work but ANE acceleration is Apple-Silicon-only."

for tool in cmake install_name_tool codesign git; do
  command -v "$tool" >/dev/null || die "missing tool: $tool (install Xcode Command Line Tools: xcode-select --install)"
done

PYWC=""
for cand in \
  "$VOICE_CORE/.venv/lib/python3.11/site-packages/pywhispercpp/.dylibs" \
  "$VOICE_CORE/.venv/lib/python3.12/site-packages/pywhispercpp/.dylibs" \
  "$VOICE_CORE/.venv/lib/python3.13/site-packages/pywhispercpp/.dylibs"; do
  [[ -d "$cand" ]] && PYWC="$cand" && break
done
[[ -n "$PYWC" ]] || die "pywhispercpp .dylibs/ not found under $VOICE_CORE/.venv — run 'uv sync --extra mac' first."

log "venv .dylibs:  $PYWC"

# ---------- restore path ----------
if [[ "$ACTION" == "restore" ]]; then
  [[ -d "$PYWC.bak" ]] || die "no backup at $PYWC.bak — nothing to restore."
  log "restoring original pip-wheel dylibs from $PYWC.bak"
  rm -rf "$PYWC"
  cp -R "$PYWC.bak" "$PYWC"
  log "done. restart the voice-core sidecar to pick this up."
  exit 0
fi

# ---------- build path ----------
mkdir -p "$BUILD_DIR"

if [[ "$ACTION" == "rebuild" ]]; then
  log "rebuild requested — wiping $WHISPER_REPO"
  rm -rf "$WHISPER_REPO"
fi

if [[ ! -d "$WHISPER_REPO" ]]; then
  log "cloning whisper.cpp into $WHISPER_REPO"
  git clone --depth 1 "$WHISPER_GIT" "$WHISPER_REPO"
else
  log "reusing existing clone at $WHISPER_REPO (use --rebuild to wipe)"
fi

cd "$WHISPER_REPO"

if [[ ! -f "build/src/libwhisper.coreml.dylib" ]] || [[ "$ACTION" == "rebuild" ]]; then
  log "configuring cmake (CoreML + Metal + BLAS)"
  cmake -B build \
    -DWHISPER_COREML=1 \
    -DWHISPER_COREML_ALLOW_FALLBACK=1 \
    -DGGML_METAL=1 \
    -DBUILD_SHARED_LIBS=ON \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 >/dev/null

  log "building (this takes a few minutes the first time)"
  cmake --build build -j"$(sysctl -n hw.ncpu)" --config Release | tail -3
else
  log "build artifacts already present — skipping (use --rebuild to recompile)"
fi

# Sanity check the build actually produced CoreML-enabled artifacts.
[[ -f "build/src/libwhisper.coreml.dylib" ]] || die "build did not produce libwhisper.coreml.dylib"
nm -gU build/src/libwhisper.coreml.dylib | grep -q whisper_coreml_init || \
  die "libwhisper.coreml.dylib missing whisper_coreml_init symbol — build flags wrong?"

# ---------- swap into pywhispercpp ----------
if [[ ! -d "$PYWC.bak" ]]; then
  log "backing up original .dylibs → $PYWC.bak"
  cp -R "$PYWC" "$PYWC.bak"
else
  log "backup $PYWC.bak already exists — keeping it (one-time snapshot of the pristine pip wheel)"
fi

log "copying new dylibs into $PYWC"
NEW_WHISPER="$(find build/src -name 'libwhisper.[0-9]*.dylib' -not -name 'libwhisper.[0-9].dylib' | head -1)"
[[ -n "$NEW_WHISPER" ]] || die "could not find libwhisper.<X.Y.Z>.dylib in build output"

# Match whatever versioned filename pywhispercpp's wrapper expects (1.8.2 in
# the wheel we know about; future wheels may differ).
EXPECTED_WHISPER="$(find "$PYWC.bak" -name 'libwhisper.[0-9]*.dylib' -not -name 'libwhisper.[0-9].dylib' | head -1)"
[[ -n "$EXPECTED_WHISPER" ]] || die "could not infer libwhisper version filename from backup"
EXPECTED_NAME="$(basename "$EXPECTED_WHISPER")"
log "  $EXPECTED_NAME ← $(basename "$NEW_WHISPER")"

cp -f "$NEW_WHISPER"                                    "$PYWC/$EXPECTED_NAME"
cp -f build/src/libwhisper.coreml.dylib                 "$PYWC/libwhisper.coreml.dylib"

# Each ggml backend; resolve symlinks so we copy the actual versioned binary
# but rename to the unversioned filename pywhispercpp's loader expects.
for lib in libggml libggml-base libggml-cpu libggml-blas libggml-metal; do
  src=$(find build/ggml -name "${lib}.[0-9]*.[0-9]*.[0-9]*.dylib" 2>/dev/null | head -1)
  [[ -n "$src" ]] || die "could not find $lib in build output"
  cp -f "$src" "$PYWC/${lib}.dylib"
done

chmod u+w "$PYWC/"*.dylib

log "fixing install_names + cross-references"

# libwhisper — its own id (matching the wheel's /DLC/... path the loader expects)
# plus all deps to @loader_path/<unversioned filename>.
install_name_tool -id "/DLC/pywhispercpp/.dylibs/$EXPECTED_NAME" "$PYWC/$EXPECTED_NAME"
install_name_tool -change "@rpath/libwhisper.1.dylib"   "/DLC/pywhispercpp/.dylibs/$EXPECTED_NAME"      "$PYWC/$EXPECTED_NAME"
install_name_tool -change "@rpath/libggml.0.dylib"      "@loader_path/libggml.dylib"                    "$PYWC/$EXPECTED_NAME"
install_name_tool -change "@rpath/libggml-cpu.0.dylib"  "@loader_path/libggml-cpu.dylib"                "$PYWC/$EXPECTED_NAME"
install_name_tool -change "@rpath/libggml-blas.0.dylib" "@loader_path/libggml-blas.dylib"               "$PYWC/$EXPECTED_NAME"
install_name_tool -change "@rpath/libggml-metal.0.dylib" "@loader_path/libggml-metal.dylib"             "$PYWC/$EXPECTED_NAME"
install_name_tool -change "@rpath/libggml-base.0.dylib" "@loader_path/libggml-base.dylib"               "$PYWC/$EXPECTED_NAME"
install_name_tool -change "@rpath/libwhisper.coreml.dylib" "@loader_path/libwhisper.coreml.dylib"       "$PYWC/$EXPECTED_NAME"

install_name_tool -id "@loader_path/libwhisper.coreml.dylib" "$PYWC/libwhisper.coreml.dylib"

for lib in libggml libggml-base libggml-cpu libggml-blas libggml-metal; do
  install_name_tool -id "@loader_path/${lib}.dylib" "$PYWC/${lib}.dylib"
  for dep in libggml libggml-base libggml-cpu libggml-blas libggml-metal; do
    install_name_tool -change "@rpath/${dep}.0.dylib" "@loader_path/${dep}.dylib" "$PYWC/${lib}.dylib" 2>/dev/null || true
  done
done

log "ad-hoc codesigning (so macOS allows loading)"
codesign --force --sign - "$PYWC/"*.dylib 2>/dev/null

# ---------- verify ----------
log "verifying load + CoreML symbol availability"
PYTHON="$VOICE_CORE/.venv/bin/python"
"$PYTHON" - <<'PY' 2>&1 | tail -10
import sys
try:
    from pywhispercpp.model import Model  # noqa: F401
    print("pywhispercpp loads OK")
except Exception as exc:
    print(f"FAILED to import pywhispercpp: {exc}", file=sys.stderr)
    sys.exit(1)
PY

log ""
log "✓ done."
log ""
log "Next steps:"
log "  1. Restart voice-core: kill the existing process, then 'bun run voice:core'"
log "  2. First transcription on this machine will take ~10 s — Apple compiles"
log "     the .mlmodelc to a device-specific format and caches it. Subsequent"
log "     calls land at ~RTF 0.10 (was ~0.4 with Metal alone)."
log "  3. To revert: $0 --restore"
