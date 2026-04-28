"""
Bulk model downloader for voice-core.

Pulls the weights every CPU-tier engine needs into `<models_dir>/<engine>/`
so a fresh deck can transcribe end-to-end without manual setup. Skips any
file that already exists at the right size.
"""

from __future__ import annotations

import logging
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

LOG = logging.getLogger("voice-core.pull")


_KOKORO_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
_SHERPA_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download"


def _download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        LOG.info("skip (exists): %s", dest)
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    LOG.info("fetch: %s -> %s", url, dest)
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)  # noqa: S310 (controlled URL)
    tmp.rename(dest)


def _download_tarball(url: str, target_dir: Path, expect_marker: str) -> None:
    """Download a `.tar.bz2`, extract, and flatten the top-level dir."""
    if (target_dir / expect_marker).exists():
        LOG.info("skip (exists): %s", target_dir)
        return
    target_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tarball = Path(td) / "archive.tar.bz2"
        LOG.info("fetch: %s -> %s", url, tarball)
        urllib.request.urlretrieve(url, tarball)  # noqa: S310
        LOG.info("extract: %s", tarball)
        with tarfile.open(tarball, "r:bz2") as tf:
            tf.extractall(td)  # noqa: S202 (trusted release)
        # Find the unique top-level dir inside td (other than archive.tar.bz2).
        candidates = [p for p in Path(td).iterdir() if p.is_dir()]
        if not candidates:
            raise RuntimeError(f"tarball {url} contained no directory")
        src = candidates[0]
        for child in src.iterdir():
            dest = target_dir / child.name
            if dest.exists():
                if dest.is_dir():
                    shutil.rmtree(dest)
                else:
                    dest.unlink()
            shutil.move(str(child), str(dest))


def pull_kokoro(models_dir: Path) -> None:
    target = models_dir / "kokoro-82m"
    for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
        _download(f"{_KOKORO_BASE}/{name}", target / name)


def pull_silero_vad(models_dir: Path) -> None:
    target = models_dir / "silero-vad"
    _download(
        f"{_SHERPA_BASE}/asr-models/silero_vad.onnx",
        target / "silero_vad.onnx",
    )


def pull_sherpa_streaming(models_dir: Path) -> None:
    """Streaming Zipformer EN — backbone for sherpa-onnx-streaming."""
    target = models_dir / "sherpa-streaming"
    url = (
        f"{_SHERPA_BASE}/asr-models/"
        "sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2"
    )
    _download_tarball(url, target, expect_marker="tokens.txt")


def pull_sherpa_tts(models_dir: Path) -> None:
    """English VITS voice — fallback for sherpa-onnx-tts.

    `amy-medium` (22050 Hz) is markedly clearer than `amy-low` (16 kHz);
    the low variant has audible phoneme-repetition artefacts on long text.
    """
    target = models_dir / "sherpa-tts"
    url = (
        f"{_SHERPA_BASE}/tts-models/"
        "vits-piper-en_US-amy-medium.tar.bz2"
    )
    _download_tarball(url, target, expect_marker="tokens.txt")


def pull_moonshine(models_dir: Path) -> None:
    """
    Trigger the moonshine-onnx package's HF download into its cache so the
    first transcription doesn't block on a network round-trip.
    """
    try:
        from moonshine_onnx import MoonshineOnnxModel  # type: ignore
    except Exception as exc:  # noqa: BLE001
        LOG.info("skip moonshine (not installed): %s", exc)
        return
    target = models_dir / "moonshine-tiny"
    if any(target.rglob("*.onnx")):
        LOG.info("skip moonshine (onnx present): %s", target)
        return
    LOG.info("warming moonshine/tiny via HF cache")
    MoonshineOnnxModel(model_name="moonshine/tiny")


PULL_FUNCS = {
    "kokoro": pull_kokoro,
    "silero": pull_silero_vad,
    "sherpa-streaming": pull_sherpa_streaming,
    "sherpa-tts": pull_sherpa_tts,
    "moonshine": pull_moonshine,
}


def pull_all(models_dir: Path, only: list[str] | None = None) -> None:
    targets = only or list(PULL_FUNCS.keys())
    unknown = [t for t in targets if t not in PULL_FUNCS]
    if unknown:
        raise SystemExit(f"unknown pull target(s): {unknown}")
    for name in targets:
        try:
            PULL_FUNCS[name](models_dir)
        except Exception as exc:  # noqa: BLE001
            LOG.error("%s pull failed: %s", name, exc)


def cli(argv: list[str] | None = None) -> int:
    import argparse

    from voice_core.config import load_settings

    parser = argparse.ArgumentParser(prog="voice-core pull")
    parser.add_argument(
        "targets",
        nargs="*",
        help=f"Subset of {sorted(PULL_FUNCS)}. Empty = all.",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level="INFO",
        format="[%(asctime)s] %(name)s %(levelname)s: %(message)s",
    )
    settings = load_settings()
    LOG.info("models_dir = %s", settings.models_dir)
    pull_all(settings.models_dir, only=args.targets or None)
    return 0


if __name__ == "__main__":
    sys.exit(cli())
