"""voice-core — local audio inference sidecar for CONTROL DECK."""

import os
import sys
from pathlib import Path

__version__ = "0.1.0"

_SENTINEL = "VOICE_CORE_LD_PATCHED"


def _onnxruntime_capi() -> Path | None:
    try:
        import onnxruntime  # type: ignore
    except Exception:  # noqa: BLE001
        return None
    return Path(onnxruntime.__file__).resolve().parent / "capi"


def _ensure_unversioned_symlink(capi: Path) -> None:
    """sherpa-onnx's native module hardcodes `libonnxruntime.so` (no version
    suffix), but onnxruntime ships `libonnxruntime.so.1.x.y`. Plant a symlink
    so the unversioned name resolves."""
    versioned = sorted(capi.glob("libonnxruntime.so.*"))
    if not versioned:
        return
    target = versioned[0]
    unversioned = capi / "libonnxruntime.so"
    # `unversioned.exists()` follows symlinks, so a dangling symlink reads as
    # missing — but Path.symlink_to() refuses to overwrite. Detect symlinks
    # explicitly and rewrite if the target moved.
    if unversioned.is_symlink() and unversioned.readlink().name != target.name:
        try:
            unversioned.unlink()
        except OSError:
            return
    if not unversioned.exists() and not unversioned.is_symlink():
        try:
            unversioned.symlink_to(target.name)
        except OSError:
            pass


def _ensure_ld_library_path() -> None:
    """ld.so reads LD_LIBRARY_PATH at process start. If we're not already
    re-exec'd with the right path, update env and re-exec Python so sherpa-onnx
    can dlopen libonnxruntime.so."""
    if os.environ.get(_SENTINEL) == "1":
        return
    capi = _onnxruntime_capi()
    if capi is None:
        return
    _ensure_unversioned_symlink(capi)
    current = os.environ.get("LD_LIBRARY_PATH", "")
    if str(capi) in current.split(":"):
        return
    new_env = os.environ.copy()
    new_env["LD_LIBRARY_PATH"] = f"{capi}:{current}" if current else str(capi)
    new_env[_SENTINEL] = "1"
    # Re-exec only when sys.argv[0] is a real script path. `python -c "..."`
    # leaves sys.argv = ['-c'] which cannot be reconstructed.
    if sys.argv and not sys.argv[0].startswith("-"):
        os.execvpe(sys.executable, [sys.executable, *sys.argv], new_env)


_ensure_ld_library_path()
