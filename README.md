# control-deck

A Next.js 16 control surface for local + hosted AI workflows — chat, dojo, tool runs, live music, agent-go, etc. Runs on Bun.

## Setup

```bash
bun install
```

## Run

```bash
bun run dev
```

Dev server: <http://localhost:3333>.

Other scripts:

| Command | What it does |
|---|---|
| `bun run dev` | Next dev server on :3333 |
| `bun run build` | Next production build |
| `bun run start` | Next production server on :3333 |
| `bun run lint` | ESLint (next lint) |
| `bun run terminal-service` | Standalone PTY terminal service (see `scripts/terminal-service.ts`) |

## Environment

Copy / create `.env.local` at the repo root. Notable variables:

- `DECK_TOKEN` — bearer token required on every `/api/*` request (see `middleware.ts`). **If this is unset or empty, API auth is disabled** and the deck is fully open (file upload, code exec, search proxy, etc. all exposed). Set it for any non-local deployment.
- Provider API keys (set the ones you use): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `HUGGINGFACE_API_KEY`, `OPENROUTER_API_KEY`.
- Local-LLM endpoints (optional): `OLLAMA_HOST`, `LLAMA_SERVER_URL`, `VLLM_URL`, `LMSTUDIO_URL`.
- `LLM_PROVIDER`, `LLM_MODEL` — default provider + model for new chats.

## Package manager

This project standardizes on **bun** (lockfile: `bun.lock`). `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml` are gitignored — don't add them.

## Full-stack helper

`start-full-stack.sh` boots the Next app alongside the auxiliary services (AGUI backend, Comfy, etc.). Read the script before running — it assumes a specific local layout.

## Desktop app (Electron)

Control Deck ships as a cross-platform Electron app that wraps the same Next.js surface plus native OS adapters (AT-SPI / AX / UIA) so one cockpit drives web + terminal + native apps.

### Dev

```bash
bun run dev          # terminal 1 — Next server on :3333
bun run electron:dev # terminal 2 — Electron window loading localhost:3333
```

### Package (Linux AppImage)

```bash
bun run electron:pack
```

This runs `next build` (with `output: "standalone"`), copies prebuilt native `.node` binaries into the standalone output via `scripts/copy-native-binaries.cjs`, compiles the Electron main/preload into `.electron-dist/`, then invokes `electron-builder` using `electron-builder.yml`. Artifact lands at `dist-electron/Control Deck-<version>.AppImage` (~180 MB compressed, ~480 MB unpacked).

The Linux build ships CPU-only ONNX runtime by default. To include the CUDA / TensorRT providers (adds ~370 MB), run `INCLUDE_GPU_PROVIDERS=1 bun run electron:pack`.

macOS and Windows targets are pre-configured in `electron-builder.yml` but not yet smoke-tested — signing requires certificates (Apple Developer for macOS; Azure Trusted Signing recommended for Windows).

### Architecture

- `electron/main.ts` — main process. Picks a free port, spawns the Next standalone server via `ELECTRON_RUN_AS_NODE=1`, waits for readiness, loads the URL in a `BrowserWindow`.
- `electron/preload.ts` — minimal `window.deck` surface (platform info + IPC invoke).
- `scripts/electron-after-pack.cjs` — copies `.next/standalone` + `.next/static` + `public/` into the packaged `resources/app/` (works around electron-builder's node_modules stripping in extraResources).
- `components/preflight/PreflightGate.tsx` — blocking modal on boot that probes Agent-GO / Ollama / SearXNG / terminal-service and shows install hints for whichever required service is down.
- `lib/tools/native/` — native-surface adapters. Linux (`linux-atspi.ts` + `scripts/atspi-helper.py`) is live; macOS (AX) and Windows (UIA) are stubbed with clear error messages. Synthetic input via optional `@nut-tree/nut-js` in `input-common.ts`.

### Data dirs

In packaged builds, the SQLite DB path resolves via:

1. `DECK_DB_PATH` env var (if set)
2. `${CONTROL_DECK_USER_DATA}/data/deck.db` (set by Electron main from `app.getPath("userData")`)
3. `${XDG_STATE_HOME:-$HOME/.local/state}/control-deck/data/deck.db`

Running from source still uses `./data/deck.db` if that directory exists.
