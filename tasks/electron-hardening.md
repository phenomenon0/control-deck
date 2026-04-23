# Electron Hardening Plan

Generated: 2026-04-23. Branch: master @ cdd3238.

Phase A output (harden-and-stay) from the multi-agent Electron audit. No framework migration in this plan.

## Files that will change (full list)

### Phase 1 — Fragility fixes (safe, small, 1-2 days total)

| # | Task | File(s) touched | New file? |
|---|---|---|---|
| 1 | Port-pick TOCTOU | `electron/main.ts` | — |
| 2 | Next.js supervisor | `electron/main.ts` | — |
| 3 | Terminal-service packaging | `package.json`, `scripts/postbuild-electron.cjs`, `electron-builder.yml`, `electron/services/terminal-service.ts` | — |
| 4 | DECK_TOKEN fail-closed | `middleware.ts`, `electron/main.ts`, `electron/preload.ts`, `lib/deck/client.ts` (if exists) | — |
| 11 | Code-exec sandbox fallback | `lib/tools/code-exec/sandbox/linux.ts` | — |
| 12 | Stale portal secret cleanup | `electron/main.ts` | — |

### Phase 2 — Process isolation (the real work)

| # | Task | File(s) touched | New file? |
|---|---|---|---|
| 5 | `sandbox: true` + preload audit | `electron/main.ts`, `electron/preload.ts`, `electron/services/themed-browser.ts` | — |
| 6 | node-pty → UtilityProcess | `electron/services/pty-host.ts` (new), `electron/services/terminal-service.ts`, `app/api/terminal/**`, `components/panes/terminal/**` | ✅ |
| 7 | onnxruntime → UtilityProcess | `electron/services/inference-host.ts` (new), `lib/embeddings/**` | ✅ |

### Phase 3 — Perf & polish

| # | Task | File(s) touched | New file? |
|---|---|---|---|
| 8 | V8 code cache | `electron/main.ts` | — |
| 9 | Defer heavy imports | `lib/live/transport.ts`, `components/panes/audio/**`, `components/canvas/**`, `components/chat/ArtifactRenderer.tsx` | — |
| 10 | electron-hardener fuses | `electron-builder.yml`, `scripts/apply-fuses.cjs` (new) | ✅ |

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

- Full migration to CEF/Tauri/Qt WebEngine — see audit report
- `@google/model-viewer` dedup guard (open question from audit)
- `wl-activate.py` python startup cost (150 ms per call)
- Windows UIA via koffi (currently stubbed)
- `protocol.interceptStreamProtocol` for Next in-process (deferred; try phase 1-3 first)

## Rollback

Every commit is small and reversible. If any phase regresses, revert the single commit — no cascade.
