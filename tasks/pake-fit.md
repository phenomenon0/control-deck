# Pake fit analysis for control-deck

Generated: 2026-06-20. Branch: master @ dcb950d.
Companion to `tasks/electron-alternatives.md` — this extends that audit specifically for Pake (github.com/tw93/Pake) using a six-agent review of runtime/packaging, native-OS automation, themed-browser/CDP, web/UI surface, backend services, and Pake's own capabilities and hard limits.

---

## 1. Deck review (what it is, deeply)

Control Deck is a Next.js 16 app (port 3333) wrapped by Electron 41. Electron's main process doubles as both the desktop shell and the Node runtime for the HTTP server: in production, `main.ts:537` spawns `.next/standalone/server.js` by re-invoking `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, so the same binary that draws the window also serves all `/api/*` routes. Three additional out-of-process sidecars are auto-supervised — `terminal-service` (node-pty over WebSocket, `:4010`), `agent-ts` (pi-agent-core chat backend, `:4244`), and `voice-core` (Python FastAPI STT/TTS/VAD, `:4245`) — making it a four-process cooperative stack where all business logic lives in the Next server and Electron main is a pure supervisor + IPC hub. Four C/C++ native modules (better-sqlite3, node-pty, koffi, node-screenshots) are `serverExternalPackages` and `asarUnpack`'d, requiring explicit ABI management against Electron's embedded Node version via `electron-rebuild`. On Linux, a fifth service — a portal bridge HTTP server on a random loopback port — runs inside Electron main and owns D-Bus sessions for xdg-desktop-portal (ScreenCast, RemoteDesktop), Wayland key injection, and pixel-level click dispatch. On macOS the equivalent is a compiled Swift binary spawned per-call; on Windows it is a C# UIA host (`WinAutomationHost.exe`). The renderer (Electron `BrowserWindow`) loads `http://localhost:3333/deck` and has the `DECK_TOKEN` injected into every fetch via `session.defaultSession.webRequest.onBeforeSendHeaders` — an Electron-only hook that replaces manual auth header management on the client side.

**Load-bearing constraints:**

| Constraint | Why it is structural |
|---|---|
| `ELECTRON_RUN_AS_NODE=1` embedded Next.js server spawn | The Electron binary itself is used as the Node runtime for the HTTP server (`main.ts:537`). Non-Electron shells must ship a separate Node binary (Strategy 2 in `electron-alternatives.md`). |
| Four native `.node` modules | better-sqlite3, node-pty, koffi, node-screenshots — all built against Electron's Node ABI. A bare webview has no Node runtime to load `.node` files. |
| CDP `--remote-debugging-port` on the `BrowserWindow` | Set via `app.commandLine.appendSwitch` when `CONTROL_DECK_DEVTOOLS_PORT` is set (`main.ts:213-226`). Exposes the themed-browser as a CDP target for `browser-harness`. WebKitGTK has no equivalent port. |
| xdg-desktop-portal D-Bus sessions (Linux portal bridge) | Requires a GUI process identity registered with xdg-desktop-portal. The Python daemons (`remote-desktop.py`, `screencast-capture.py`) are run in the context where the portal is reachable — guaranteed by Electron inheriting the user's D-Bus session. |
| `session.defaultSession.webRequest.onBeforeSendHeaders` | Injects `X-Deck-Token` into every renderer fetch transparently (`main.ts:644-656`). No equivalent hook exists in WebKitGTK/Tauri/Wry. |
| `process.execPath` / `process.resourcesPath` / `app.getPath()` | Used to locate the Next server entry, staged native binaries, and user-data directories. Platform-agnostic fallbacks exist for `userData` (XDG) but `process.resourcesPath` is Electron-only. |
| `electron-fuse RunAsNode` intentionally left enabled | `apply-fuses.cjs:14-17` explicitly documents the deliberate non-flip. The Electron binary must stay in RunAsNode mode to host the Next server. This cannot be changed without shipping a separate Node binary. |

**Health notes / debt spotted** (from multi-agent review):

- `copy-native-binaries.cjs` only stages node-pty and better-sqlite3 into `.next/standalone`. koffi and node-screenshots are NOT copied — latent `MODULE_NOT_FOUND` if those modules are ever imported from a Next.js Route Handler in a packaged build.
- `better-sqlite3` uses the V8 embed ABI (not N-API). A future Electron upgrade crossing a V8 ABI boundary will silently kill all database routes; the ABI probe at `main.ts:155-164` logs a warning but does not abort startup.
- The portal handoff file `/tmp/control-deck-portal-${uid}.json` persists across crashes (not cleaned on SIGKILL). PID-liveness check in `linux-atspi.ts` discards stale handoffs, but the file remains on disk until the next clean launch.
- `WinAutomationHost.exe` is explicitly STUBBED (`windows-host.ts:32`). All Windows UIA tools (`native_invoke`, `native_wait_for`, `native_with_cache`, etc.) fail at runtime on Windows today regardless of shell choice.
- `InlineBrowserPane.tsx:44` detects Electron via `typeof window.process === 'object'` — a fragile heuristic that any bundler polyfilling `process` would trigger. `ComfyPane`'s `window.deck?.electronVersion` check is more reliable and should be the standard.
- The voice-core supervisor has a hard 3-restart/5-min budget with no jitter. After `gaveUp=true`, the only recovery is an operator-initiated restart via IPC. VoicePane shows a connect button but does not expose the restart action.
- `koffi` struct registrations are cached on `globalThis` to survive Next.js HMR in dev. If koffi is upgraded and the cache is stale, `initKoffi` errors are swallowed and the broken bindings are used until server restart.
- `start-full-stack.sh` is Linux bash only (shebang, `pkill`, Linux paths). No equivalent Windows launcher exists.

---

## 2. The one hard constraint

**CDP loss on Linux blocks any wholesale shell swap to Pake/Tauri.**

Evidence chain:

1. `electron/main.ts:213-226` — `app.commandLine.appendSwitch('remote-debugging-port', String(port))` exposes every `WebContentsView` as a first-class CDP target when `CONTROL_DECK_DEVTOOLS_PORT` is set.
2. `browser-harness/helpers.py:71-72, 102, 110, 131` — `browser-harness` attaches via `Input.dispatchMouseEvent`, `Page.captureScreenshot`, `Target.getTargets`, and `Target.activateTarget` to the running Chromium instance. These are CDP methods over a TCP/IP port.
3. `tasks/electron-alternatives.md:58` — "Single deal-breaker for every non-Electron candidate on Linux: CDP loss."
4. Pake on Linux uses WebKit2GTK via Tauri's `wry` crate. WebKit2GTK does not expose a CDP-compatible TCP port. The `--debug` pake-cli flag opens WebKit's own Web Inspector panel inside the window using WebKit's native inspector protocol — not CDP. `WEBKIT_INSPECTOR_SERVER` provides a remote-inspection mechanism over WebKit's own protocol, which is explicitly not CDP and not compatible with Playwright, Puppeteer, or `browser-harness`.

**What Pake is (and isn't).** Pake is thinner than raw Tauri: it is a build-time CLI that generates Tauri config and invokes `tauri build`. The output is a single webview per window (PakeConfig `windows` vector exists but `set_window()` calls `windows.first()` only — no split-pane or multi-`WebContentsView` composition). There is no built-in Node sidecar mechanism — Tauri's documented sidecar pattern (`externalBin`, shell plugin) exists but requires dropping below `pake-cli` to edit `src-tauri/` directly. Pake also has no runtime IPC surface; it produces a binary, not a programmable shell.

Control-deck uses Chromium's CDP not in its own codebase (zero CDP method calls in `electron/`) but as the interface `browser-harness` consumes. Swapping the shell to Pake eliminates CDP access on Linux entirely — `browser-harness` cannot attach to a running Pake window and the core automation capability (composite click through iframes/shadow DOM at the compositor level, page screenshots, tab enumeration) is lost. On Windows, WebView2 is Chromium-based but Pake does not expose `--remote-debugging-port` either, making this a cross-platform blocker for `browser-harness`, not a Linux-only issue.

---

## 3. Where Pake fits

### Verdict table

| Niche | Verdict | Feasibility | Effort | Value | What it gives up |
|---|---|---|---|---|---|
| `local-chat-companion` — Pake window pointing at the already-running `start-full-stack.sh` backend (dev mode, no `DECK_TOKEN`) | **viable-with-caveats** | **medium** (dev) / high (stated) | hours (dev mode) | medium | Terminal offline, themed-browser dead, CDP for browser-harness gone, all sidecars must be pre-started manually |
| `windows-thin-client` — Pake + WebView2 companion to standalone Next server on Windows | **viable-with-caveats** | medium | days-to-week | medium | Terminal degrades (node-pty ABI management), themed-browser dead, `native_*` tools already broken (WinAutomationHost STUBBED), no Windows launcher script |
| `macos-chat-kiosk` — Pake/WKWebView pointing at localhost:3333 on macOS | **viable-with-caveats** | medium (end-user) | hours (dev) / days (distribution) | low | Electron build already works perfectly on macOS with full automation; Gatekeeper unsigned; mic requires src-tauri edit |
| `inference-monitor-panel` — always-on-top 400×640 Pake window wrapping `/deck/models` | **viable-with-caveats** | medium | days | medium | Needs standalone layout route (DeckShell sidebar unusable at 400px); production auth requires fetch-monkey-patch inject; exists as stalled `apps/model-tray` skeleton |
| `remote-team-dashboard` — Pake wrapping a LAN-hosted deck backend | **viable-with-caveats** | medium | week+ | medium | SSE auth universally broken (EventSource can't send headers, no `?token=` bypass); CORS absent; `/api/tools/bridge` and `/api/terminal/config` have hard loopback-only guards |
| `always-on-voice-widget` — 320×480 tray window wrapping `/deck/voice-lab` | **viable-with-caveats** | **low** | week | high | Microphone permission requires src-tauri capability edit (not a pake-cli flag); production auth injection is multi-file; DeckShell layout breaks at 320px; new standalone route required |
| `hosted-remote-demo` — Pake wrapping a cloud-hosted deck | **viable-with-caveats** | medium | days (infra) + week (auth) | high | Same SSE auth problem; CORS absent; `/api/tools/bridge` origin-guarded; voice WS hardcoded to 127.0.0.1; acceptable only with `DECK_TOKEN` unset (publicly open API) |
| `inference-rig-monitor` — Pake on workstation watching remote GPU rig | **rejected** | low | — | low | CORS absent, no auth headers on any hardware fetch hook, `EventSource` unauth, `denyIfCrossOrigin` blocks tool bridge; value delta over pinned browser tab is negligible |

**Rejected niches:**

- **`inference-rig-monitor`**: every hardware hook (`useSystemStats`, `useOllamaPs`, `useGpuProcesses`, `useHardwareProviders`) issues bare `fetch()` with zero auth headers. Without the Electron `webRequest` hook, all return 401 in production. Additionally, CORS is absent (`next.config.ts` sets no `headers()`) and `denyIfCrossOrigin` in `lib/security/originGuard.ts` blocks the tool bridge for cross-origin callers. The residual value — a pinned always-on-top panel showing GPU stats — is achievable with a browser tab at zero packaging cost. The Pake-specific additions (tray, shortcut) are not worth the required server-side security policy changes.
- **Any wholesale Electron → Pake replacement**: Pake is single-webview, no Node sidecar by default, no CDP, no `BaseWindow`+`WebContentsView` composition, no `session.webRequest` hook, and no `contextBridge`/`ipcRenderer`. The gap between Pake's feature set and what control-deck's Electron main process provides is not bridgeable at the `pake-cli` layer.

### Surviving niches in detail

**`local-chat-companion` (highest confidence viable niche)**

Run `start-full-stack.sh` (which sets `NODE_ENV=development`, leaving `DECK_TOKEN` unset). `middleware.ts:27-34` passes all `/api/*` unconditionally in dev mode. The Pake binary — `pake http://localhost:3333/deck/chat --name 'Control Deck' --show-system-tray --hide-on-close --activation-shortcut 'CmdOrControl+Shift+P'` — needs zero code changes to the backend. The chat surface (ChatSurface, useAgentRun, useThreads, ApprovalPeek polling) contains zero `window.deck` or `ipcRenderer` calls. Terminal shows "offline" (acceptable), themed-browser is dead (acceptable for chat-only scope). The `--hide-title-bar` immersive header is macOS-only; Linux/Windows get a standard title bar. The key blocker is that `start-full-stack.sh` does not start `voice-core` — users who want STT/TTS in the chat window must separately run `uv run voice-core serve`. Navigation lockdown to `/deck/chat` requires a `pake-cli`-level `--internal-url-regex` workaround or an inject script; navigating to `/deck/workspace` in the Pake window reaches broken panes. Production-mode auth (any deployment where `DECK_TOKEN` is set) requires an inject script patching `window.fetch` plus an EventSource wrapper — or the `?token=` middleware patch for SSE endpoints. This is the lowest-friction Pake niche: one command to build, no server changes in dev mode.

**`inference-monitor-panel` (direct match for the stalled `apps/model-tray` skeleton)**

`InferenceControlPane` and its ten sub-components (`OverviewTab`, `ModalityTab`, `SystemTab`, provider cards, suggestion strips) are verified pure-fetch against `/api/inference/*` with no `window.deck`, no IPC, no native modules. The stalled `apps/model-tray` Tauri skeleton (empty `src-tauri/`, no source, compiled target) confirms the owner already validated this shape. Pake replaces the entire `src-tauri/` authoring burden with a single command. Two code changes are required before the niche is usable: (1) a standalone layout variant for `/deck/models` — the existing layout unconditionally renders `DeckShell` with a 240px sidebar that consumes the intended 400px window width, and `useDeckSettings()` throws without `DeckSettingsProvider` in scope; (2) a 10-line inject script to attach `X-Deck-Token` to `fetch()` calls in production mode. Dev-mode (no `DECK_TOKEN`) works with zero changes today and is the right starting point. The `apps/model-tray` skeleton should be deleted or replaced by a Pake build script once this niche is committed to.

**`windows-thin-client` (addresses Windows-specific gap)**

On Windows, the Electron build's native automation layer is non-functional: `WinAutomationHost.exe` is explicitly STUBBED and koffi-backed `SendInput`/`EnumWindows` only reaches the binary when the UIA host is built. A Pake + WebView2 companion wrapping `localhost:3333` loses nothing that currently works on Windows (chat, canvas, voice, models, hardware stats, agent runs). WebView2 is Chromium-based and renders the Next.js/React UI faithfully including modern CSS, `AudioContext`, and `EventSource`. Required: (1) a Windows process-supervisor script (PowerShell or `.bat`) that starts Next standalone, agent-ts, and optionally voice-core before launching the Pake window — this does not exist yet; (2) a 20-line fetch-inject JS for `DECK_TOKEN` if production mode is needed. The `start-full-stack.sh` bash script is non-functional on Windows without WSL/Git Bash. This is a genuine gap worth filling but effort is days-to-week due to the Windows launcher absence, not hours.

**`macos-chat-kiosk`**

Technically sound — WKWebView supports all voice and chat primitives, `macos-ax-helper.bin` works server-side independently of Electron. But the value case is weak: the macOS Electron build works completely, auto-manages all sidecars, and provides full native automation. The Pake build is for users who explicitly want to avoid the Electron build — a narrow audience. Gatekeeper will block an unsigned binary; notarization requires an Apple Developer account. `NSMicrophoneUsageDescription` in `Info.plist` must be added at the `src-tauri` level (not via pake-cli) for voice to work. This niche is viable but only marginally better than a Safari web app shortcut.

---

## 4. Recommendation

**The single clearest place Pake earns its keep: the `inference-monitor-panel` to replace the stalled `apps/model-tray` skeleton.**

The skeleton in `apps/model-tray` is four compiled Tauri binaries and an empty `src-tauri/` with no application source — it was abandoned mid-authoring. Pake replaces everything that stalled it. `InferenceControlPane` is confirmed pure-fetch with no Electron IPC. Two scoped code changes unblock it: a `/deck/models-standalone` route with a minimal provider tree (no sidebar, no `DeckShell`), and a 10-line pake inject script for production-mode auth. Total effort: one day. The result is a ~5 MB always-on-top floating panel showing live VRAM, provider health, and model-swap controls — something the current Electron cockpit cannot offer without bringing up the full workspace.

If that is built, `local-chat-companion` follows for free: the inject script is reused, and pointing the tray binary at `/deck/chat` instead of `/deck/models-standalone` works in dev mode with literally one `pake` command.

**Everything else is "not yet worth it" for one of two reasons:**

- **Niches that require authentication fixes** (remote-team-dashboard, hosted-remote-demo, always-on-voice-widget in production): the root problem is that `middleware.ts` has no `?token=` query-param bypass for SSE endpoints and no CORS config, and `EventSource` cannot carry `Authorization` headers. Fixing this is a week of middleware + client-side changes and has security implications (query params appear in server logs). Until those fixes land, any remote-facing or production-auth Pake niche is plumbing work, not a Pake decision.
- **Niches that duplicate what a browser tab already provides with less friction** (inference-rig-monitor): the value delta is a tray icon and a keyboard shortcut. Ship a browser tab shortcut instead.

**What Pake cannot do and must not be asked to do:** replace Electron as the primary shell. The CDP loss on Linux (WebKitGTK, no `--remote-debugging-port`) is permanent at the `pake-cli` layer. The `browser-harness` tool depends on CDP being reachable on the running Chromium instance. Pake is a thin client add-on, not a shell replacement. Electron stays as the packaging target for the full cockpit.

**Suggested next step:** delete `apps/model-tray`, add a `pake:monitor` npm script that wraps the `pake` invocation, and add a `?standalone=1` check to `app/deck/layout.tsx` to suppress `DeckShell` for the panel route. Open a ticket to add `?deck_token=` bypass to SSE endpoints in `middleware.ts` — that single change unblocks the remote and voice-widget niches in one shot when the time is right.
