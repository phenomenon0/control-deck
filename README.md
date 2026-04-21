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
- `lib/tools/native/` — native-surface adapters. Linux (`linux-atspi.ts` + `scripts/atspi-helper.py` for AT-SPI; `scripts/remote-desktop.py` daemon for portal key/type/click_pixel) and macOS (`macos-ax.ts` + compiled `scripts/macos-ax-helper.bin` using AXUIElement + CGEvent) are live. Windows (UIA) is stubbed with a clear error message. `input-common.ts` is a latent `@nut-tree/nut-js` fallback — the live adapters bypass it.

### Data dirs

In packaged builds, the SQLite DB path resolves via:

1. `DECK_DB_PATH` env var (if set)
2. `${CONTROL_DECK_USER_DATA}/data/deck.db` (set by Electron main from `app.getPath("userData")`)
3. `${XDG_STATE_HOME:-$HOME/.local/state}/control-deck/data/deck.db`

Running from source still uses `./data/deck.db` if that directory exists.

### Themed browser windows

Any external link opened from inside the deck — chat links, tool dashboards,
plugin tickers, `window.open`, `<a target="_blank">`, or a deliberate
`window.deck.browser.open(url)` call — spawns a themed Chromium window instead
of handing the URL to the OS default browser.

Each themed window is a standalone OS window with Control Deck's dark palette:
a 40px header (back, forward, reload/stop, URL input, close) sitting above a
full-bleed web view. The header route is `/browser`; the web view is a plain
`WebContentsView` loading the target URL.

**Programmatic API** (exposed via preload as `window.deck.browser`):

```ts
// Open a new themed window
await window.deck.browser.open("https://example.com");

// Drive the active window from inside its header
await window.deck.browser.navigate("https://other.example");
await window.deck.browser.back();
await window.deck.browser.forward();
await window.deck.browser.reload();
await window.deck.browser.stop();
await window.deck.browser.close();

// Subscribe to nav state (only meaningful inside the /browser header route)
const unsubscribe = window.deck.browser.onState((state) => {
  console.log(state.url, state.title, state.loading);
});
```

The implementation lives in `electron/services/themed-browser.ts`
(`BaseWindow` + two `WebContentsView`s, header/page split, IPC routing keyed by
the header's `webContents.id`). The page view is a first-class CDP target, so
once the devtools port is enabled it attaches just like a regular tab.

### Browser automation (browser-harness)

Control Deck exposes a CDP endpoint on demand so
[browser-harness](../ai_tools/browser-harness) and similar tools can drive the
main deck window **and** any themed browser window as ordinary Chromium tabs.

The devtools port is **opt-in** — off by default in both dev and packaged
builds, on only when `CONTROL_DECK_DEVTOOLS_PORT` is set.

```bash
# Launch the deck with CDP on (dev)
CONTROL_DECK_DEVTOOLS_PORT=9223 bun run electron:dev

# In another terminal — attach the harness to whatever's listening there
./scripts/attach-harness.sh <<'PY'
# page_info, screenshot, click, js, etc. are pre-imported
print(page_info())
screenshot("/tmp/deck.png")
PY
```

`scripts/attach-harness.sh` reads `http://127.0.0.1:<port>/json/version`,
extracts the `webSocketDebuggerUrl`, then execs `browser-harness` with
`BU_CDP_WS` and `BU_NAME=control-deck` set. Any arguments you pass to the
script are forwarded to `browser-harness` unchanged.

**Attaching to a specific themed browser window** instead of whatever the
harness picks first:

```python
targets = cdp("Target.getTargets")["targetInfos"]
for t in targets:
    print(t["targetId"], t["url"])
# Then `set_target(targetId)` or drive via its session.
```

**Caveats**

- The harness's `new_tab(url)` calls `Target.createTarget`, which in Electron
  creates a page but no visible `BrowserWindow`. To open a **visible** themed
  window from the harness, evaluate `window.deck.browser.open(url)` on the main
  deck page via `js(...)` instead, then re-list targets.
- Driving `window.deck.browser.close()` via `js(..., target_id=<header>)` will
  raise a `JSONDecodeError` inside the harness — the header target destroys
  itself before it can flush the CDP response. The Electron side still closes
  cleanly; it's purely a harness-side read artifact. Real users clicking the
  header's X button never see this. If you need to close a themed window from
  the harness, evaluate on the main deck target (once a `closeById` surface
  lands) or drive the X button with a coordinate click.
- The port is sticky across the whole Electron app — exposing it in production
  means any local process can drive the deck. Don't set
  `CONTROL_DECK_DEVTOOLS_PORT` in packaged builds you ship to users.
- `remote-allow-origins=*` is set alongside the port so the harness's
  WebSocket handshake isn't rejected. Combined with the "dev-only" posture,
  this is fine — do not flip it on in production.
