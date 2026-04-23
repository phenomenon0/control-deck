# Electron Hardening Plan

Generated: 2026-04-23. Branch: master @ cdd3238.
Updated: 2026-04-23 after Phase B research round — see `tasks/electron-alternatives.md`.

Phase A output (harden-and-stay) from the multi-agent Electron audit. No framework migration in this plan.

**Alternatives verdict (from Phase B):** Stay on Electron. Tauri/Wails blocked on Linux by WebKitGTK lacking a CDP `--remote-debugging-port` — our themed-browser CDP target is load-bearing for browser-harness. Full write-up in `tasks/electron-alternatives.md`.

## Files that will change (full list)

### Phase 1 — Fragility fixes (safe, small, 1-2 days total) — DONE ✅

| # | Task | File(s) touched | New file? | Status |
|---|---|---|---|---|
| 1 | Port-pick TOCTOU | `electron/main.ts` | — | done (`0b0e0a1`) |
| 2 | Next.js supervisor | `electron/main.ts` | — | done (`0b0e0a1`) |
| 3 | Terminal-service packaging | `package.json`, `scripts/build-terminal-service.cjs` (new), `scripts/electron-after-pack.cjs`, `electron/services/terminal-service.ts`, `.gitignore` | ✅ | done (`629f7e9`) |
| 4 | DECK_TOKEN fail-closed | `middleware.ts`, `electron/main.ts` | — | done (`0bff4d8`) |
| 11 | Code-exec sandbox fallback | `lib/tools/code-exec/sandbox/linux.ts` | — | done (this commit) |
| 12 | Stale portal secret cleanup | `electron/main.ts` | — | done (`0b0e0a1`) |

### Phase 2 — Process isolation (the real work)

| # | Task | File(s) touched | New file? |
|---|---|---|---|
| 5 | `sandbox: true` + preload audit | `electron/main.ts`, `electron/preload.ts`, `electron/services/themed-browser.ts` | — |
| 6 | node-pty → UtilityProcess (see §Phase 2 recipe below) | `electron/services/pty-host.ts` (new), `electron/services/terminal-service.ts`, `app/api/terminal/**`, `components/panes/terminal/**` | ✅ |
| 7 | onnxruntime → UtilityProcess | `electron/services/inference-host.ts` (new), `lib/embeddings/**` | ✅ |

### Phase 2b — High-leverage fixes surfaced by the alternatives audit

| # | Task | File(s) touched | New file? |
|---|---|---|---|
| 14 | Per-tab `session.fromPartition()` for themed-browser views + tighten DECK_TOKEN `webRequest` filter to `defaultSession` only | `electron/services/themed-browser.ts`, `electron/main.ts` | — |
| 15 | Portal handoff: PID verification + secret rotation, or (preferred) replace file with `stdio: [..., 'ipc']` handshake | `electron/main.ts` | — |
| 16 | macOS entitlements audit — remove `allow-unsigned-executable-memory` / `disable-library-validation` / `allow-dyld-environment-variables` to the minimum each native dep actually needs | `electron-builder.yml`, mac entitlements plist, `scripts/electron-after-pack.cjs` | — |
| 17 | Pin `remote-allow-origins` to a specific browser-harness port + README note that CDP-on = full browser control to any local UID process | `electron/main.ts`, `README.md` | — |

### Phase 3 — Perf & polish

| # | Task | File(s) touched | New file? | Notes |
|---|---|---|---|---|
| 8 | V8 code cache | `electron/main.ts` | — | **DEFER — needs profiling first.** AppImage startup is squashfs+bundle-load bound, not V8-parse bound. VS Code benefits because it parses 1000s of extension files cold; we have one Next bundle. Don't ship until a profile shows parse on the critical path. |
| 9 | Defer heavy imports | `lib/live/transport.ts`, `components/panes/audio/**`, `components/canvas/**`, `components/chat/ArtifactRenderer.tsx` | — | |
| 10 | electron-hardener fuses | `electron-builder.yml`, `scripts/apply-fuses.cjs` (new) | ✅ | **SCOPED.** `RunAsNode` fuse CANNOT be flipped — the embedded Next server depends on `ELECTRON_RUN_AS_NODE=1` (same constraint as VS Code's extension host). Flip only: `NodeCliInspect=false`, `EnableCookieEncryption=true`, `OnlyLoadAppFromAsar=true` (macOS/Windows), `EmbeddedAsarIntegrityValidation=true` (macOS/Windows). AppImage gains nothing from ASAR fuses. |

---

## Phase 2 recipe — pty-host UtilityProcess (from DeepWiki `microsoft/vscode`)

Concrete pattern to copy for task #6 (and analogously for #7 onnx-host):

1. **Spawn.** `utilityProcess.fork(require.resolve('./pty-host.js'), ['--logsPath', ...], { stdio: 'pipe', type: 'ptyHost' })`. Entry point is a standalone module.
2. **MessagePort handoff.** Main calls `const { port1, port2 } = new MessageChannelMain(); child.postMessage(null, [port2]);`. Pty-host receives via `process.parentPort.once('message', e => port = e.ports[0])`.
3. **RPC layer.** Wrap the port with a named-channel server (equivalent of VS Code's `ProxyChannel.fromService()`). Channels: `pty-host:log`, `pty-host:heartbeat`, `pty-host:pty`. Frame each call with a request ID; respond by ID; proxy events (`onProcessData`) back to caller.
4. **Crash handling.** `child.on('exit', (code) => { if (!shuttingDown && restarts < MAX_RESTARTS) restart(); })`. Heartbeat ping every N seconds; if no ack, mark unresponsive and surface to UI.
5. **Direct renderer path (optimization).** For high-frequency data (terminal output), let the renderer request a *direct* MessagePort to the pty-host via `ipcMain.handle('acquire-pty-port', ...)` that returns a fresh `utilityProcess.connect()` port. Main becomes the broker for lifecycle only; data bypasses main.
6. **Native module.** Pty-host is the only process that imports `node-pty`. With `sandbox: true` on the renderer (task #5), the renderer cannot load `node-pty` anyway — this is the architectural enforcement.

**Do not migrate `better-sqlite3` the same way.** It's synchronous by design; moving it to a UtilityProcess via MessagePort turns every call async and breaks the entire data layer. Keep sqlite in the Next sidecar.

---

## Phase 2b recipe — per-tab session partition (from DeepWiki `microsoft/vscode`)

VS Code's `BrowserSession` uses 3 scopes. Adapt directly:

- **Global cockpit window** — keep `session.defaultSession`. This is where DECK_TOKEN injection stays scoped.
- **Ephemeral themed-browser tab** — `session.fromPartition(`control-deck-tab-${viewId}`)`, unique per view. Cookies/storage disappear when the window closes.
- **Persistent themed-browser tab (if we add this later)** — `session.fromPartition('persist:control-deck-browser')`.

Pass via `new WebContentsView({ webPreferences: { session, ... } })`. Register narrow permission handlers per-session (allow only what the tab actually needs — likely none to start). **Tighten the DECK_TOKEN `webRequest.onBeforeSendHeaders` filter to `defaultSession` only** — with per-tab partitions this becomes a belt-and-braces defense since themed tabs no longer share the session that ever saw the token.

---

## Recommended execution order (revised)

Previous order was strict 1→10. Revised after alternatives audit:

1. **Task 5** — `sandbox: true` (independent, small, unblocks all renderer-compromise work).
2. **Task 14** — per-tab session partition (5-line fix, highest-leverage item not on original list).
3. **Task 15** — portal PID verification / stdio IPC (security).
4. **Task 9** — lazy imports (free perf win).
5. **Task 17** — pin CDP `remote-allow-origins` (small, same commit window as 15 if both touch main.ts).
6. **Task 6** — pty UtilityProcess (big, on a branch, use the Phase 2 recipe above).
7. **Task 7** — onnx UtilityProcess (big, on a branch, analogous to #6).
8. **Task 16** — macOS entitlements audit (requires macOS build target).
9. **Task 10 (scoped)** — fuses polish pass, after sandbox + UP work stabilizes.
10. **~~Task 8~~** — DEFERRED pending a profile. Likely skip.

## Audit files (reference only, not edited)

- `electron/services/screencast.ts` — documents dbus-next ABI break (context for why isolation matters)
- `electron/services/remote-desktop-client.ts` — same
- `electron/services/wl-activator.ts` — TODO about python startup overhead (future work)
- `scripts/terminal-service.ts` — needs compiled JS twin for packaged build (see task 3)

## Decision rules

- Each task ships as its own commit. Don't batch.
- After each commit: run `bun run typecheck` + `bun run electron:compile`. If either fails, fix before next task.
- Keep `electron:dev` working at every commit. No multi-commit broken states.
- Tasks 1, 11, 12 have no user-visible behavior change — land first.
- Task 5 (sandbox:true) may break preload — guard with a feature env var, land behind a flag first.
- Tasks 6/7 (UtilityProcess) are the biggest — branch off before starting.

## Verification

- `bun run typecheck` after every edit
- `bun run electron:dev` — confirm window opens, terminal pane works, chat streams
- On task 3: `bun run electron:pack` and run the packaged AppImage; confirm terminal pane is alive
- On task 5: confirm preload still exposes `deck.invoke`, `deck.browser`, `deck.portal`
- On task 6/7: open multiple terminals, kill the pty-host, confirm app stays alive; kill the inference-host, confirm embeddings call returns a clean error

## Out of scope (flagged but not in this plan)

- Full migration to CEF/Tauri/Qt WebEngine — see `tasks/electron-alternatives.md` for the honest verdict (blocked on CDP-in-WebKitGTK for Linux primary target).
- **"Process Split" (Strategy 2)** — extract Next server from `ELECTRON_RUN_AS_NODE` into a real external Node binary, enabling future shell swaps. Not urgent; tracked as the on-ramp.
- `@google/model-viewer` dedup guard (open question from audit)
- `wl-activate.py` python startup cost (150 ms per call)
- Windows UIA via koffi (currently stubbed)
- `protocol.interceptStreamProtocol` for Next in-process (deferred; try phase 1-3 first)

## Rollback

Every commit is small and reversible. If any phase regresses, revert the single commit — no cascade.
