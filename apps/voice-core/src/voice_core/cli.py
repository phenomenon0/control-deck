"""
voice-core CLI entry point.

Two subcommands:
    serve      — start the FastAPI server (default).
    health     — print local /health output for one tier and exit.

Mirrors the env vars consumed by `voice_core.config.load_settings`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys

import uvicorn

from voice_core import __version__
from voice_core.config import Settings, load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="voice-core", description="CONTROL DECK voice-core sidecar")
    sub = parser.add_subparsers(dest="cmd")

    p_serve = sub.add_parser("serve", help="Start the FastAPI server (default).")
    p_serve.add_argument("--host", default=None)
    p_serve.add_argument("--port", type=int, default=None)
    p_serve.add_argument("--tier", default=None, choices=["T1_MAC", "T2_CUDA", "T3_CPU"])
    p_serve.add_argument("--log-level", default=None)
    p_serve.add_argument("--reload", action="store_true")

    p_health = sub.add_parser("health", help="Print local /health snapshot and exit.")
    p_health.add_argument("--tier", default=None, choices=["T1_MAC", "T2_CUDA", "T3_CPU"])

    p_pull = sub.add_parser("pull", help="Download all CPU-tier engine models.")
    p_pull.add_argument("targets", nargs="*", help="Subset of engines to pull. Empty = all.")

    args = parser.parse_args(argv)
    cmd = args.cmd or "serve"

    if cmd == "serve":
        return _serve(args)
    if cmd == "health":
        return _health(args)
    if cmd == "pull":
        from voice_core.pull import cli as pull_cli

        return pull_cli(list(args.targets))
    parser.print_help()
    return 1


def _serve(args: argparse.Namespace) -> int:
    settings = load_settings(host=args.host, port=args.port, tier_id=args.tier)
    log_level = (args.log_level or settings.log_level).lower()
    logging.basicConfig(
        level=log_level.upper(),
        format="[%(asctime)s] %(name)s %(levelname)s: %(message)s",
    )
    logging.getLogger("voice-core").info(
        "voice-core %s starting host=%s port=%d tier=%s models=%s",
        __version__,
        settings.host,
        settings.port,
        settings.tier_id,
        settings.models_dir,
    )

    if args.reload:
        # Reload requires an importable factory string.
        uvicorn.run(
            "voice_core.cli:_uvicorn_factory",
            host=settings.host,
            port=settings.port,
            log_level=log_level,
            reload=True,
            factory=True,
        )
    else:
        from voice_core.server import build_app

        uvicorn.run(
            build_app(settings),
            host=settings.host,
            port=settings.port,
            log_level=log_level,
        )
    return 0


def _health(args: argparse.Namespace) -> int:
    settings = load_settings(tier_id=args.tier)
    from voice_core import registry
    from voice_core.engines import register_all

    register_all()
    snapshot = registry.snapshot(settings)
    payload = {
        "ok": True,
        "tier": settings.tier_id,
        "version": __version__,
        "engines": {
            engine_id: {
                "available": engine.available(),
                "loaded": engine.loaded(),
                "kind": engine.meta.kind,
                "label": engine.meta.label,
            }
            for engine_id, engine in snapshot.items()
        },
    }
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


# Reload mode shim — uvicorn's `reload=True` requires a factory string. The
# factory below takes no args and reads env vars (so reload-on-edit still works
# after `uv run voice-core serve --reload`).
def _uvicorn_factory():  # pragma: no cover — used by --reload
    from voice_core.server import build_app

    return build_app(load_settings())
