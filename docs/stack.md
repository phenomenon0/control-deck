# Stack: bundling, pinning, and drift control

Control Deck spans five package ecosystems (bun/node, a uv-managed Python
env, a conda env, external git repos, and host binaries). Everything is pinned
declaratively; `bun scripts/doctor.ts` verifies the pins hold and prints the
exact recovery command when they don't.

## Sources of truth

| File | Pins |
|---|---|
| `mise.toml` | tool versions: node, bun, uv, process-compose |
| `bun.lock` | all JS deps — root + `apps/agent-ts` (bun workspace). **npm is banned in this repo**; use `bun` / `bun x` |
| `pyenvs/omni/` | `pyproject.toml` + `uv.lock` for `.venv-omni` (CUDA torch pinned via the pytorch index) |
| `stack.lock.json` | external repo commits (s2s, atlas, llama.cpp), venv↔project mapping, host-service registry |
| `process-compose.yml` | service definitions: commands, env, health probes, dependency order |

## Daily ops

```bash
./start-full-stack.sh            # doctor (quick) + start stack detached
./start-full-stack.sh status     # process table + host-service probes
./start-full-stack.sh attach     # live TUI (logs, restart individual procs)
./start-full-stack.sh stop
./start-full-stack.sh doctor     # full drift check
```

Logs: `~/.local/state/control-deck/{agent-ts,controldeck,s2s-lab}.log`.

## New machine bootstrap

1. Install toolchain at the versions in `mise.toml` (or `mise install`).
2. `bun install --frozen-lockfile`
3. Rebuild any Python env you need (byte-identical from lock):
   `UV_PROJECT_ENVIRONMENT=$PWD/.venv-omni uv sync --frozen --directory pyenvs/omni`
4. Clone external repos at pinned commits — `doctor` prints the exact
   `git clone … && git checkout …` for anything missing.
5. `./start-full-stack.sh`

## Drift policy

- Upgrading a dep = change the manifest, regenerate the lock, commit both.
  Never mutate a venv/node_modules directly and walk away.
- External repo moved ahead? Deliberate → update the commit in
  `stack.lock.json`. Accidental → doctor gives you the checkout command.
- Doctor exit code is CI-ready: `bun scripts/doctor.ts --quick` fails on any
  stray lockfile, toolchain mismatch, or stale lock.

## Known non-uniform corners (accepted, documented)

- **voice-api (chatterbox, :8000)** runs from a miniforge/conda env at
  `~/Documents/INIT/voice-api` — boot-managed, not uv-managed. Registered in
  `stack.lock.json → hostServices` so doctor at least watches it.
- **vectordb (:4242)** is a standalone binary at `~/v/vectordb`, boot-managed.
- **searxng/** holds only a dormant `settings.yml`; nothing launches it. If it
  comes back, run it as a podman container (podman 5.x is installed; no docker).
- **`.venv-voice`** is orphaned (old voice-core kokoro/moonshine stack, 695 MB)
  — safe to delete.
- **`.venv-vllm`** is orphaned (vllm 0.19.1 env, ~10 GB) — safe to delete. The
  deck only ever talks to vLLM as an externally-launched OpenAI-compat server
  (`lib/hardware/providers/vllm.ts`; "start it yourself with `vllm serve`"),
  so the pinned `pyenvs/vllm/` had no launcher and was dropped.
- **llama.cpp/** is a gitignored vendored clone, CUDA-built on host; pinned by
  commit in `stack.lock.json`.
