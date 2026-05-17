#!/usr/bin/env python3
"""
End-to-end smoke test for ControlDeckAgent.predict().

Builds a synthetic OSWorld observation (real screenshot via xdg-portal +
faked AT-SPI tree string) and verifies the agent returns a parseable
list of pyautogui actions or a sentinel.

Why synthetic obs: avoids pulling in the full OSWorld VM/Docker stack
just to validate that our predict() shape conforms. The real
DesktopEnv integration lives in run_osworld.py (Phase 2).

Usage (local — default — uses llama-swap on :8080):
    python3 benchmarks/osworld/run_smoke.py

Usage (remote OpenAI-compat backend):
    OSWORLD_AGENT_BASE_URL=https://api.openai.com/v1 \\
    OSWORLD_AGENT_API_KEY=sk-... \\
    OSWORLD_AGENT_MODEL=gpt-4o \\
    python3 benchmarks/osworld/run_smoke.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from control_deck_agent import ControlDeckAgent, SENTINELS


REPO_ROOT = Path(__file__).resolve().parents[2]


def grab_real_screenshot() -> bytes:
    """Use the same portal helper the native adapter uses, so the obs
    looks like what a real OSWorld task would see on this host."""
    out = subprocess.run(
        ["bun", str(REPO_ROOT / "lib/tools/native/cli.ts"), "screen-grab"],
        capture_output=True, text=True, check=True, cwd=REPO_ROOT,
    )
    payload = json.loads(out.stdout)
    import base64
    return base64.b64decode(payload["pngBase64"])


SYNTHETIC_A11Y = """
[frame] "Files - Home" (app=org.gnome.Nautilus, x=120 y=80 w=1200 h=800)
  [tool bar] (x=120 y=110 w=1200 h=40)
    [push button] "New Folder" (x=140 y=120 w=100 h=24)
    [push button] "Search" (x=260 y=120 w=80 h=24)
    [text] "Location: /home/omen" (x=360 y=120 w=400 h=24)
  [list] "Files" (x=120 y=160 w=1200 h=720)
    [list item] "Documents" (x=140 y=180 w=180 h=24)
    [list item] "Downloads" (x=140 y=210 w=180 h=24)
    [list item] "Pictures" (x=140 y=240 w=180 h=24)
"""

INSTRUCTION = "Open the Documents folder."


def main() -> int:
    print("--- grabbing real screenshot via portal ---")
    try:
        screenshot = grab_real_screenshot()
        print(f"  ok: {len(screenshot)} bytes PNG")
    except subprocess.CalledProcessError as e:
        print(f"  WARN: screenshot helper failed ({e.stderr.strip()[:200]}), using empty bytes", file=sys.stderr)
        screenshot = b""

    print("--- calling agent.predict() ---")
    agent = ControlDeckAgent(observation_type="screenshot_a11y_tree")
    info, actions = agent.predict(
        instruction=INSTRUCTION,
        obs={"screenshot": screenshot, "a11y_tree": SYNTHETIC_A11Y},
    )

    print(f"  model={info['model']} finish={info['finish_reason']} in={info['input_tokens']} out={info['output_tokens']}")
    print(f"  parsed {len(actions)} action(s):")
    for i, a in enumerate(actions):
        kind = "sentinel" if a in SENTINELS else "code"
        snippet = a if len(a) <= 120 else a[:117] + "..."
        print(f"    [{i}] {kind}: {snippet}")

    print("\n--- raw model response ---")
    print(info["raw"])

    # Pass criteria: at least one action, all actions are either sentinels
    # or syntactically-valid python (parseable by ast). We don't care if
    # the click coordinates are right — the parser+API contract is what
    # this test gates.
    import ast
    failures: list[str] = []
    if not actions:
        failures.append("predict() returned no actions")
    for a in actions:
        if a in SENTINELS:
            continue
        try:
            ast.parse(a)
        except SyntaxError as e:
            failures.append(f"action did not parse as python: {e}: {a!r}")

    if failures:
        print("\nFAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1

    print("\nOK — agent.predict() honors the OSWorld contract.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
