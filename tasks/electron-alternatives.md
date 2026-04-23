# Electron Alternatives & Pattern Analysis

Generated: 2026-04-23. Branch: master @ 22ba1df.
Companion to `tasks/electron-hardening.md` — this is the Phase B output (the "alternatives + why/why-not" doc the prior audit referenced but never wrote).

Based on a 4-agent research round: **patterns** (top-tier Electron apps), **alternatives** (Tauri/Wails/native), **critique** (apply/skip verdicts per control-deck's threat model), **synergy** (compounding combos + named strategies).

---

## TL;DR

1. **Stay on Electron.** Tauri/Wails are blocked for control-deck by a single hard constraint: **WebKitGTK has no CDP port on Linux**, and CDP-driven `WebContentsView` tabs are load-bearing for browser-harness. Until wry exposes `--remote-debugging-port` on Linux, the shell swap loses a core capability.
2. **Strategy 1 ("Harden the Ship") is the right call now** — finish Phase 2/3 of the hardening plan in the order specified. ~1–2 weeks of work, fully reversible per-commit.
3. **Two items missing from the Phase 2/3 list are higher-leverage than things on it**:
   - Per-tab `session.partition` for themed-browser `page` views (cookies/storage/token currently bleed across every site).
   - Portal-handoff PID verification + secret rotation on launch.
4. **Reconsider V8 code cache (task #8).** Critique + synergy converge on "probably not worth it" for control-deck's shape. See §5.
5. **Strategy 2 ("Process Split" — Node as true sidecar, not `ELECTRON_RUN_AS_NODE`) is the prerequisite for any future shell swap.** Not urgent, but track it as the on-ramp.

---

## 1. Industry pattern catalog

What top-tier Electron apps actually do. Condensed from the Patterns agent output; evidence citations in the raw transcript.

| # | Pattern | Canonical user | Key mechanism |
|---|---|---|---|
| 1 | Stratified multi-process (main / UtilityProcess / renderer) | VS Code | `utilityProcess.connect()` → `MessagePort`; pty-host, shared-process, agent-host each isolated |
| 2 | Renderer hardening: `sandbox: true` + `contextIsolation` + narrow `contextBridge` | Slack, 1Password, VS Code | `app.enableSandbox()` globally; dependency-cruiser bans Node imports in renderer |
| 3 | Named-channel IPC with `ProxyChannel` service typing | VS Code | `IMessagePassingProtocol` abstract transport; one `ChannelServer` on main, `ChannelClient`s everywhere else |
| 4 | Native module exile — `.node` files banned from sandboxed renderers | VS Code | `RequireInterceptor`; extension-host + pty-host own all native addons |
| 5 | V8 code cache per scheme | VS Code | `VSCODE_CODE_CACHE_PATH` env; custom schemes registered with `codeCache: true` |
| 6 | Three-bundle split (main / renderer / preload) with lazy imports | VS Code, Slack, Notion | Bundler-enforced boundaries; `React.lazy` / `next/dynamic` for heavy modules |
| 7 | `BaseWindow` + `WebContentsView` composition (multi-pane windows) | Figma (invented `BrowserView`, successor `WebContentsView` since Electron 30) | One `BaseWindow` with no own renderer, N `WebContentsView`s each with their own preload |
| 8 | `@electron/fuses` at package time | 1Password | Flip `runAsNode`, `nodeCliInspect`, `cookieEncryption`, `onlyLoadAppFromAsar`, `embeddedAsarIntegrityValidation` — OS enforces |
| 9 | Custom auto-update with arch-aware assets | VS Code | Per-arch CI artifacts; `AbstractUpdateService` per platform; no electron-updater |
| 10 | Sandboxed child webview / separate origin for untrusted content | VS Code, Figma, Obsidian | `sandbox="allow-scripts allow-same-origin"` iframe for plugin hosts; `child_process.fork` in Obsidian |
| 11 | Production perf telemetry (not just dev-machine profiling) | VS Code, Slack, Notion | Named performance marks; continuous flamegraphs (Palette.dev); `process.getCPUUsage()` sampling |

**Two novel findings worth calling out**:

- **Embedding a Next.js standalone server inside Electron is architecturally unusual.** The survey found no major shipping app that does this — only community boilerplates (`nextron`, `next-electron-rsc`, DoltHub blogs). Most teams use static export + `file://` or a minimal custom HTTP server. Control-deck's `ELECTRON_RUN_AS_NODE=1` + Next standalone is double-novel: reusing the Electron binary as Node is done by VS Code for the extension host, but not to run an HTTP app server. This means the pattern has few precedents to copy defensive measures from.
- **VS Code does NOT use `@electron/fuses`.** Because VS Code depends on `ELECTRON_RUN_AS_NODE=1` for the extension host, it cannot flip `runAsNode` off. Control-deck has the same constraint (the embedded Next server uses RunAsNode). This means `@electron/fuses` adoption (task #10) is structurally limited to the fuses compatible with our architecture — specifically `nodeCliInspect`, `cookieEncryption`, and `embeddedAsarIntegrityValidation`, NOT `runAsNode`.

---

## 2. Alternatives matrix

| Criterion | Tauri 2.x | Wails v3 | Neutralinojs | wry (raw) | Zed/GPUI | Qt/CEF | Lightened Electron |
|---|---|---|---|---|---|---|---|
| Node sidecar for Next server | Yes (`externalBin`) | Yes (self-rolled) | Yes (extensions) | Yes (self-rolled) | **N/A** | Yes (spawn) | **Already exists** |
| Multi-webview in one window | Unstable feature | Not confirmed | **Single only** | Yes (DIY compositor) | N/A | Yes | Native (`BaseWindow`) |
| CDP / `Input.dispatchMouseEvent` | **No on Linux** (WebKitGTK) | **No** (WebKitGTK) | **No** | **No on Linux** | N/A | Yes (Chromium) | **Yes** |
| Native adapter portability (AT-SPI / AX / UIA) | Neutral | Neutral | Neutral | Neutral | N/A | Neutral | Neutral |
| Migration effort (shell only) | Months | Months | Weeks-months | Months | Non-starter | Months | **Days-weeks** |
| Extra binary shipped | ~40-60 MB (Node) | ~40-60 MB | ~40-60 MB | ~40-60 MB | N/A | ~40-60 MB | Zero (Electron bundles Node) |

**Single deal-breaker for every non-Electron candidate (on Linux, our primary target): CDP loss.** The themed-browser `page` view being a first-class CDP target is what lets `browser-harness` drive tabs with `Input.dispatchMouseEvent` and `Page.captureScreenshot`. Tauri uses wry/WebKitGTK on Linux — no `--remote-debugging-port`. Wails same. Neutralinojs same. Only Qt WebEngine and CEF embed real Chromium, but both require writing a new C++/Rust embedding layer from scratch (no TypeScript-native Node glue for either).

**Qt/CEF is theoretically the only "shell swap with CDP preserved" path**, but the integration cost is several months and there is no ready-made Node/TS binding. Not a realistic near-term option.

**The `apps/model-tray` Tauri sub-app that already exists in the repo is a separate scope** — a tray utility, not a cockpit shell. It doesn't create leverage for a main-window port because the main window's blocker (CDP) isn't a tray-window concern.

---

## 3. Apply / Skip / Qualify verdicts

Combining the critique agent's verdicts with what the Phase 2/3 hardening plan already lists. Control-deck's threat model: single-user local app, ~180 MB AppImage, realistic attackers are "malicious third-party site in themed-tab" and "supply-chain attack on npm native dep" — NOT nation-state.

| Pattern | Phase 2/3 task # | Verdict | Reason |
|---|---|---|---|
| `sandbox: true` on all three WebContentsViews | 5 | **APPLY** | Current preload uses only `contextBridge` + `ipcRenderer` — sandbox-compatible. Page view has no preload, free to flip. |
| `contextIsolation: true` | already on | APPLY | Keep. Don't regress. |
| `nodeIntegration: false` | already on | APPLY | Keep. |
| `node-pty` → UtilityProcess | 6 | **QUALIFY** | This is a crash-isolation win (pty segfault won't kill app), NOT a security win (renderer can't reach node-pty today anyway). Worth doing, but reframe the rationale. |
| `onnxruntime-node` → UtilityProcess | 7 | **QUALIFY** | Same reasoning. Also limits blast radius of a bad ONNX model (supply-chain). Watch out: don't lump `better-sqlite3` into the same migration — it's sync-by-design and becoming async via `MessagePort` round-trips is a semantic change. |
| V8 code cache for renderer | 8 | **RECONSIDER / LIKELY SKIP** | AppImage startup is dominated by squashfs decompression + Next standalone bundle load, not V8 parse. Profile before doing. VS Code benefits because it parses thousands of extension files cold; control-deck has one bundle. |
| Defer heavy imports (Tone/monaco/model-viewer) | 9 | **APPLY** | Free win. Dynamic `import()` on use. Real startup impact. |
| `@electron/fuses` at package time | 10 | **QUALIFY** | Can NOT flip `runAsNode` — the app depends on it for the embedded Next server. Flip `nodeCliInspect`, `cookieEncryption`, `embeddedAsarIntegrityValidation` (macOS only — AppImage doesn't benefit). Skip the rest. |

### Higher-priority items NOT on the Phase 2/3 list

These came out of the critique — they beat most of the listed tasks on return-on-effort:

1. **Per-tab `session.fromPartition()` for themed-browser `page` views.** Today all three views share `session.defaultSession`. Cookies, localStorage, IndexedDB from site A persist and are visible to site B when the user navigates the themed tab. The `DECK_TOKEN` injection filter (`webRequest.onBeforeSendHeaders` scoped to `${serverOrigin}/api/*`) is the only guard against token leakage; any third-party URL whose path matches `/api/*` receives the token. 5 lines per tab fixes this. **High-leverage. Add as task #13.**
2. **Portal-handoff PID verification + secret rotation.** `/tmp/control-deck-portal-${uid}.json` is 0o600, but `before-quit` cleanup doesn't run on SIGKILL, and the file's `pid` field is written but never *read* back to verify liveness before honoring the secret. Rotate the secret on every launch AND verify the stored PID matches a live Electron process before accepting portal calls. **High-leverage. Add as task #14.**
3. **macOS entitlements audit.** `allow-unsigned-executable-memory`, `disable-library-validation`, `allow-dyld-environment-variables` are all set. Required for the native deps, but supply-chain compromise of any one of them = dyld injection on a notarized binary. Audit which entitlements each dep *actually* needs. **Worth more than `@electron/fuses` work.** Add as task #15.
4. **Pin `remote-allow-origins` to the specific browser-harness port, not `http://127.0.0.1`.** Currently any local process can attach CDP when the port is up. Document as "opt-in = full browser control handed to any local code".

---

## 4. Compounding combos & antagonistic pairs

### Compounding (A+B > A and B separately)

- **Combo A (renderer-compromise containment):** `sandbox: true` (#5) + node-pty UtilityProcess (#6) + onnx UtilityProcess (#7) + fuses (#10 limited). Each piece plugs a different escape route. Sandbox alone is defeated by RunAsNode; fuses alone don't help if renderer already has Node; UtilityProcess alone is just crash isolation. Together: compromised renderer → dead end.
- **Combo B (startup):** V8 cache (#8, if we keep it) + lazy imports (#9). Cache only covers modules that loaded; lazy defers the heavy ones. Each one alone underperforms.
- **Combo C (themed-browser isolation):** session.partition (new #13) + CSP on main window + sandbox on `page` view (#5). Three-layer defense against hostile third-party content.
- **Combo D (future-proofing):** Process Split (Strategy 2) + Next `output: "standalone"` (already shipped). The standalone bundle is the thing a true Node sidecar would run. We're one step away.

### Antagonistic (A fights B)

- **V8 code cache + frequent Electron upgrades.** V8 bytecode format is version-specific; cache invalidates every upgrade, forcing cold-parse cost again. This is a specific reason to be skeptical of task #8 — Electron ships major versions fast.
- **`sandbox: true` + too-permissive preload allowlist.** The preload is the perimeter. If future devs add IPC channels without security review, sandbox becomes theater.
- **UtilityProcess + `better-sqlite3`.** `better-sqlite3` is sync by design — moving it into a UtilityProcess means every DB call becomes async via `MessagePort`. Do NOT combine #7 with a sqlite migration in the same pass. Keep SQL in the Next sidecar where it lives now.
- **Custom scheme (`app://`) + Next.js routing.** Plan already defers this; keep it deferred.

---

## 5. Three named strategies + decision map

### Strategy 1: "Harden the Ship" — **PICK THIS NOW**

Finish Phase 2/3 roughly as planned, with the adjustments above (reconsider #8, add #13/#14/#15).

- Pieces: sandbox flip + audit preload, pty UtilityProcess, onnx UtilityProcess, lazy imports, selected fuses, per-tab session.partition, portal PID verification, entitlements audit.
- Synergy: Combo A + Combo B + Combo C all land.
- Tradeoff: architectural complexity unchanged; `ELECTRON_RUN_AS_NODE` sidecar remains.
- Effort: **S (1–2 weeks).**
- Blast radius: ~10 files + 3 new files. Each task is its own commit, fully reversible.

### Strategy 2: "The Process Split" — **TRACK AS ON-RAMP**

Replace `ELECTRON_RUN_AS_NODE=1` with a real external Node binary running the Next standalone server; Electron main becomes thin (window + IPC + supervisor).

- Prerequisite for any future shell swap (Tauri/Qt/CEF all need this).
- Portal handoff moves from env-var injection to a Unix-socket handshake.
- Crash domains cleanly separated.
- Tradeoff: ship ~40–60 MB Node binary. Standalone Next bundle offsets some of that (no duplicated `node_modules`).
- Effort: **M (1–2 weeks split; +1 week for socket protocol).**
- Blast radius: `electron/main.ts`, `electron-builder.yml`, `scripts/electron-after-pack.cjs`, portal bridge.

### Strategy 3: "Tauri Shell + Node Sidecar" — **BLOCKED**

Full shell swap, after Strategy 2. Blocked on CDP-on-Linux story.

- Revisit if: (a) wry exposes `--remote-debugging-port` on Linux, or (b) we accept running a separate headless Chromium for agent-drivable tabs, or (c) browser-harness stops needing CDP.
- Until one of those changes, **do not start**. Effort L (2–3 months). Blast radius: enormous.

### Strategy 4: "Hybrid Shell (Tauri + Electron)" — **REJECTED**

Ships both runtimes. Worst-of-both. Name it only to dismiss it.

### Decision map

| Your pain is... | Pick |
|---|---|
| Renderer compromise via malicious site in themed tab | Strategy 1 (sandbox + session.partition + fuses) |
| Startup sluggish / warm launch feels slow | Strategy 1 (lazy imports; reconsider V8 cache) |
| pty or ONNX crash takes down whole app | Strategy 1 (UtilityProcess, tasks #6/#7) |
| ABI hell on native deps at each Electron upgrade | Strategy 2 (sidecar decouples Node ABI from Electron) |
| Want to preview Tauri future | Strategy 2 (the split IS the prerequisite — no Tauri commitment yet) |
| Need Tauri for binary size or memory right now | Strategy 3 — but CDP loss is fatal, don't start |

---

## 6. Action items (delta to `tasks/electron-hardening.md`)

Proposed changes to the master task list:

- **Task #8 (V8 code cache):** mark as **needs profiling first**. Don't ship until we measure that V8 parse is actually on the critical path. Likely SKIP.
- **Task #10 (fuses):** scope down to `nodeCliInspect`, `cookieEncryption`, `embeddedAsarIntegrityValidation` (macOS only). `RunAsNode` fuse is blocked by architecture.
- **New task #13:** per-tab `session.fromPartition()` for themed-browser `page` views. High priority, ~5 lines per tab + audit of `webRequest` filter. Files: `electron/services/themed-browser.ts`, `electron/main.ts`.
- **New task #14:** portal-handoff PID verification + secret rotation on every launch. Files: `electron/main.ts` (portal bridge setup).
- **New task #15:** macOS entitlements audit — narrow `allow-unsigned-executable-memory`, `disable-library-validation`, `allow-dyld-environment-variables` to only what native deps require. Files: `electron-builder.yml`, macOS `.plist`.
- **New task #16:** Pin `remote-allow-origins` to the specific browser-harness port when CDP is enabled. Document CDP-on as equivalent to full browser control for local code.

---

## 7. Open questions / missing evidence

- Does `scripts/copy-native-binaries.cjs` actually stage `koffi` and `node-screenshots` into `.next/standalone/node_modules/`? Phase 1 audit said no; verify on next packaged build. (Unrelated to this doc, but it's a latent bug.)
- `@google/model-viewer` dedup — still noted as open from the Phase A audit.
- `wl-activate.py` 150ms Python startup cost — not addressed by any strategy here.
- Whether the Electron 30+ default ASAR-integrity-on-Windows fuse interacts with our current packaging — haven't tested.
- `wry::WebContext::set_allows_automation` on Linux — does it open a CDP-compatible port, or just enable higher-level WebDriver-style automation? Would need a direct test. If the former, Tauri becomes viable and Strategy 3 unblocks.

---

## 8. Recommendation

**Do Strategy 1 over the next 1–2 weeks** in this order:

1. Task #5 (sandbox flip) — independent, small.
2. New task #13 (per-tab session.partition) — 5-line win, drop it in alongside #5.
3. New task #14 (portal PID verification) — same commit window.
4. Task #9 (lazy imports) — free perf.
5. Task #6 (pty UtilityProcess) — on a branch, bigger.
6. Task #7 (onnx UtilityProcess) — on a branch, bigger.
7. Task #10 (fuses — scoped) + New task #15 (entitlements audit) — polish pass.
8. **Defer** task #8 (V8 cache) — profile first; likely skip.

Then **keep Strategy 2 in the back pocket** as a discrete future milestone — don't start without a concrete reason (ABI upgrade pain, memory pressure, or a real Tauri opportunity emerging).
