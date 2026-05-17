# OSWorld benchmark adapter

Plug Control Deck into [OSWorld-Verified](https://os-world.github.io/) — the flagship Linux desktop computer-use benchmark. Architectural fit is direct: OSWorld observes via `a11y_tree` + `screenshot` and executes via `pyautogui`; we already have AT-SPI, xdg-desktop-portal screenshots, and native click/key/type.

## Files

| File | Purpose |
|---|---|
| `control_deck_agent.py` | OSWorld-compatible agent. Implements `predict(instruction, obs) -> (info, actions)`. Backend-agnostic via OpenAI-compatible HTTP. |
| `test_parse.py` | Unit tests for response parsing (code blocks, sentinels, edge cases). No model needed. |
| `run_smoke.py` | End-to-end smoke: real screenshot + synthetic a11y_tree → live model → parsed action. Validates the contract without OSWorld installed. |

## Run the tests

```bash
# Parser tests (offline, instant)
python3 benchmarks/osworld/test_parse.py

# Live smoke against the default backend (local llama-swap on :8080)
python3 benchmarks/osworld/run_smoke.py
```

## Backends

The agent is OpenAI-compatible everywhere. Configure via env:

| Var | Default | Notes |
|---|---|---|
| `OSWORLD_AGENT_BASE_URL` | `http://127.0.0.1:8080/v1` | llama-swap. Anything OpenAI-compatible works. |
| `OSWORLD_AGENT_API_KEY` | `local` | Backend-defined. Real key for OpenAI/Anthropic. |
| `OSWORLD_AGENT_MODEL` | `qwen3.5-9b` | Vision-capable model recommended (it sees the desktop screenshot). |

Examples:

```bash
# OpenAI
OSWORLD_AGENT_BASE_URL=https://api.openai.com/v1 \
OSWORLD_AGENT_API_KEY=sk-... \
OSWORLD_AGENT_MODEL=gpt-4o \
python3 benchmarks/osworld/run_smoke.py

# Anthropic (via OAI-compat endpoint)
OSWORLD_AGENT_BASE_URL=https://api.anthropic.com/v1 \
OSWORLD_AGENT_API_KEY=sk-ant-... \
OSWORLD_AGENT_MODEL=claude-opus-4-7 \
python3 benchmarks/osworld/run_smoke.py
```

## Contract

`ControlDeckAgent.predict(instruction: str, obs: dict) -> (info: dict, actions: list[str])`

- `obs["screenshot"]` — PNG bytes of the current desktop (optional but recommended).
- `obs["a11y_tree"]` — linearized AT-SPI dump as a string (optional).
- Returns a list whose elements are either pyautogui code strings (e.g. `"pyautogui.click(140, 180)"`) or one of the sentinels `DONE` / `WAIT` / `FAIL`.
- Empty model output is surfaced as `[FAIL]` rather than silently stalling — fail loud.

## Phase 2 — wire into real OSWorld

Not yet done. Path:

1. `pip install desktop-env` (the OSWorld python package).
2. Construct `DesktopEnv(provider_name=..., action_space="pyautogui", observation_type="screenshot_a11y_tree")`.
3. Pass `ControlDeckAgent()` into `lib_run_single.run_single_example(agent, env, ...)`.
4. Score against the OSWorld-Verified task suite.

Provider options for local execution:
- **Docker** (lowest setup) — `provider_name="docker"`. Pulls an Ubuntu image with the OSWorld controller pre-baked.
- **VMware/VirtualBox** — heaviest, most isolated.
- **Bare host** — possible but requires running the OSWorld Flask controller on this Wayland session and bypassing `DesktopEnv`'s VM lifecycle. Not recommended for first run.

Reference scores:
- SOTA (UiPath, 2026): **53.6%** on OSWorld with 50-step horizon
- Credible debut: **>15%**
- Strong: **>35%**
