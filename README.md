<h1 align="center">⬢ Control Deck</h1>

<p align="center">
  <b>One cockpit for every surface your agent needs to touch.</b><br>
  Chat, code, terminal, browser, native apps, live music, vision — behind a single UI.
</p>

---

**Control Deck** is a local-first AI cockpit. It runs your models (Ollama,
llama.cpp, vLLM, LM Studio, or any OpenAI-compatible endpoint) and your
cloud keys behind one router, then gives agents typed tools to drive your
whole machine — browser tabs, terminals, native windows, media pipelines.

Think: **Warp terminal + Linear's keyboard speed + an agent runtime**, with
the lid off.

> ⚠️ Every tool call goes through an approval gate. Your agent never runs
> code, opens a window, or touches a file without you seeing the diff.

## What it does

- 💬 **Chat with any model** — switch between local and cloud mid-thread,
  no context loss.
- 🛠️ **Run real tools** — code exec, file ops, web search, image gen,
  vector search, ComfyUI workflows. All typed, all auditable.
- 🖥️ **Drive your computer** — on Linux and macOS, agents can locate,
  click, type, and screen-grab through native accessibility APIs.
- 🌐 **Browse with themed Chromium windows** — agents open tabs as
  first-class CDP targets you can inspect live.
- 🎧 **Live-music rig built in** — Tone.js transport, mixer, FX chains on
  the same surface as chat.
- ⚡ **One keystroke away** — command palette (`Cmd/Ctrl+K`) reaches every
  pane, every tool, every setting.

## Quick start

```bash
bun install
cp .env.example .env.local
bun run dev                        # http://localhost:3333
```

Point it at local Ollama:

```env
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:7b
```

Or drop in any cloud key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, …) and pick a model from the UI.

## Desktop app

```bash
bun run electron:dev               # run locally
bun run electron:pack              # Linux AppImage (~180 MB)
```

The desktop build adds the native-OS adapters, themed browser windows, and
an opt-in CDP port for
(see the browser-harness repo — companion tool in the same INIT workspace).

---

## Under the hood

For devs peeking at the engine bay. This isn't a wrapper over someone
else's SDK — most of the interesting parts are built.

### Typed tool runtime

Every tool is a **Zod schema → executor switch → bridge registration**.
`lib/tools/definitions.ts` is the single source of truth; `executor.ts`
dispatches; `app/api/tools/bridge/route.ts` exposes an allowlist to the
Agent-GO runtime. Adding a tool is a ~20-line change and the chat UI
picks it up automatically — type-safe for the LLM-visible manifest;
input validation at the bridge is planned.

Interrupts, approvals, and diffs are not bolted on. The same executor
emits `pending → approved | rejected → running → done` events that the
chat rail renders inline. You can pause a run, edit a generated file,
approve, and the tool resumes against the edited artifact.

### Embedded Next in Electron

`electron/main.ts` picks a free port, spawns Next's **standalone server**
(`output: "standalone"`) via `ELECTRON_RUN_AS_NODE=1`, waits for
readiness, then loads the URL in a `BrowserWindow`. No dev/prod fork,
no static export, no bundler surprises — the exact same code that ships
to the web ships to the desktop.

Native deps (`better-sqlite3`, `node-pty`, `onnxruntime-node`) are
rebuilt against the Electron ABI via `@electron/rebuild` and copied into
the standalone output by `scripts/copy-native-binaries.cjs`.

### Native OS adapters

Three thin, per-OS adapters behind one `NativeAdapter` interface:

| OS | Backend | Status |
|---|---|---|
| Linux | AT-SPI via `pyatspi` + xdg-desktop-portal (ScreenCast, RemoteDesktop) | primary target |
| macOS | `AXUIElement` + `CGEvent` via a compiled Swift helper | working |
| Windows | UIA | stubbed with a clear error |

Linux screen grabs are **silent after the first portal accept** — a
Python helper persists the portal's `restore_token` under
`app.getPath("userData")` so subsequent grabs skip the dialog and return
a PNG in ~250 ms. See
[`docs/native-adapter/SKILL.md`](./docs/native-adapter/SKILL.md) for the
full per-tool coverage matrix and known failures.

### Themed browser windows with CDP

`electron/services/themed-browser.ts` composes a `BaseWindow` with two
`WebContentsView`s — a themed header (back/forward/reload/URL/close) and
a full-bleed page view. Each page view is a **first-class CDP target**.
Flip on `CONTROL_DECK_DEVTOOLS_PORT=9223` and `browser-harness` attaches
to the deck's own windows as if they were regular Chromium tabs:

```bash
CONTROL_DECK_DEVTOOLS_PORT=9223 bun run electron:dev
./scripts/attach-harness.sh <<'PY'
print(page_info())
screenshot("/tmp/deck.png")
PY
```

You get full CDP — `Input.dispatchMouseEvent`, `Network.enable`,
`Page.captureScreenshot` — across the deck, its tool dashboards, any
opened link. Agents can drive UI flows the same way a human does.

### Multi-provider model router

One `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` trio picks the default
slot. `LLM_FAST_*`, `LLM_VISION_*`, `LLM_EMBEDDING_*` override by task
so the router can send a cheap model to a classify call and a smart
model to a plan call in the same run. Provider clients live in
`lib/llm/`; OpenAI-compatible endpoints (llama.cpp `/v1`, vLLM `/v1`,
LM Studio `/v1`, OpenRouter, Groq, DeepSeek…) plug in through the
`LLM_BASE_URL` knob with no code change.

### Stack

- **Next.js 16** + **React 19** (App Router, RSC, streaming) on **Bun**
- **better-sqlite3** for threads, messages, runs, plugin state
- **onnxruntime-node** for local embeddings (CPU default, CUDA/TensorRT
  opt-in at package time via `INCLUDE_GPU_PROVIDERS=1`)
- **node-pty** for real shells in the terminal pane
- **Tone.js** for the live-music engine
- **ComfyUI** bridge for image/video workflows
- **SearXNG** for search (self-hosted, no API key)
- **Zod 4** everywhere a boundary crosses
- **Tailwind 4** with a custom Warp-inspired palette

### Security posture

- `DECK_TOKEN` gates every `/api/*` call in `middleware.ts`. Unset =
  open deck; set = bearer-required.
- Tool approval is centralized — not per-tool, not per-adapter. One gate
  means one audit surface.
- Code exec runs through a sandbox (`lib/tools/code-exec/sandbox/`) with
  `prlimit` resource limits on Linux; namespace isolation is planned but
  not yet enabled (see `lib/tools/code-exec/sandbox/linux.ts`).
- CDP port is **opt-in** and never flipped on by default in packaged
  builds. `remote-allow-origins=*` only applies when the port is up.

---

## Docs

- [`BEHAVIOR.md`](./BEHAVIOR.md) — UI invariants and keyboard contracts
- [`DESIGN.md`](./DESIGN.md) — visual language and pane system
- [`SURFACE.md`](./SURFACE.md) — tool and plugin API surface
- [`docs/native-adapter/SKILL.md`](./docs/native-adapter/SKILL.md) —
  native tool coverage matrix

## Status

Linux is the daily-driver target. macOS works. Windows runs the web
surface; the native adapter is stubbed. This is a working control layer,
not a polished product — expect opinionated defaults and the occasional
sharp edge. PRs welcome.
