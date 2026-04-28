"""
Process-wide configuration for voice-core.

Reads env vars once, exposes a frozen `Settings`. Everything that's
configurable lives here so the rest of the codebase can be pure.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from voice_core.tier import TierId, resolve_tier, TierDefaults


def _path_env(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    if not raw:
        return default
    return Path(raw).expanduser()


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    tier: TierDefaults
    models_dir: Path
    """Directory where pre-pulled weights live; mirrors VOICE_CORE_MODELS."""
    log_level: str
    debug: bool

    @property
    def tier_id(self) -> TierId:
        return self.tier.id


def load_settings(
    *,
    host: str | None = None,
    port: int | None = None,
    tier_id: str | None = None,
) -> Settings:
    repo_root = _resolve_repo_root()
    default_models = repo_root / "models" / "voice-engines"

    return Settings(
        host=host or os.environ.get("VOICE_CORE_HOST", "127.0.0.1"),
        port=port or int(os.environ.get("VOICE_CORE_PORT", "4245")),
        tier=resolve_tier(tier_id or os.environ.get("VOICE_CORE_TIER")),
        models_dir=_path_env("VOICE_CORE_MODELS", default_models),
        log_level=os.environ.get("VOICE_CORE_LOG_LEVEL", "INFO").upper(),
        debug=os.environ.get("VOICE_CORE_DEBUG", "").lower() in {"1", "true", "yes"},
    )


def _resolve_repo_root() -> Path:
    """
    Walk up from this file until we find a `package.json` — that's the deck
    root. Falls back to the working dir if nothing matches (e.g. installed
    elsewhere).
    """
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        if (parent / "package.json").exists() and (parent / "apps").exists():
            return parent
    return Path.cwd()
