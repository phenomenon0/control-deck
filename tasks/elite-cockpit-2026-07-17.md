# Elite cockpit review — verification foundation + plan iteration

Generated: 2026-07-17. Branch: voice-s2s @ c0979e2 + dirty tree (~24 modified / 9 untracked).
Method: 8-agent exploration swarm over the whole repo, key claims hand-verified,
two builder agents for tooling. Supersedes nothing — this is the 2026-07 review
layer on top of `tasks/first-grade-engine.md` (2026-07-03, T10 update 2026-07-09).

---

## What was built today (verification foundation — DONE)

The swarm's biggest finding: **the entire verification layer was red**, so no
change could be checked. That is now fixed and gated:

- `bun run verify` — one command, exit 0 today: doctor --quick → contract-check
  → tsc → eslint --quiet → scoped bun test → agent-ts tests.
- `bun test` suite green: **928 pass / 0 fail / 0 errors** (was 929/48/20).
  Root cause of the 48 fails: `mock.module()` registrations are process-global
  and **un-revertable** on bun 1.3.4; files evaluate interleaved, so mocks
  leaked across files. Six files converted to `spyOn` + `mock.restore()`.
  The 20 errors were vendored `llama.cpp/` tests swept by the unscoped glob;
  the `test` script now pins absolute roots (bare `bun test` still sweeps —
  `pathIgnorePatterns` needs bun ≥1.3.11, toolchain pin forbids; use `bun run test`).
- `bun run test:agent-ts`: the four hidden node:test suites (29 tests) are now
  wired in — previously undiscoverable from root.
- Lint: the 1 error (StudioTab `useInPipeline` callback misread as a hook) fixed
  by rename; 114 warnings are the intentional baseline.
- `scripts/contract-check.ts` (in the verify chain): 50 bridge tools ↔ executor
  ↔ zod ↔ manifest drift; agent-ts port agreement; inference-bindings validity;
  doc-reference lint (198 refs, 13 allowlisted-historical).
- `scripts/dead-components.ts`: import-graph reachability from `app/**`.
- Fixed in passing: agent-ts port skew (4243→4244, `main.ts` + `client.ts`),
  stale `voice-core` entries in `data/inference-bindings.json`, banned
  npm/npx references in the voice harness.

Known gap: one unreproduced flaky observation in `payload.property.test.ts`
(fast-check) under the old mis-scoped run; watch it.

---

## Trouble-thread scorecard (hand-verified today)

| Thread | Status 2026-07-17 | Evidence |
|---|---|---|
| T1 severed prompt pipeline | **OPEN** | `loop.ts:522` still skips `role:"system"`; memory/skills/persona inert |
| T2 five-way routing | **OPEN** | `freeTier.ts` zero importers; `OLLAMA_BASE_URL` ×33 in 19 files |
| T3 dual ledgers | **OPEN** | `agent-ts/store.ts` still persists runs.db |
| T4 Agent-GO ghost | **FIXED today** | all 5 port sources agree on 4244 |
| T5 db.ts god module | **OPEN** | 1,388 lines, 37 importers |
| T6 config sprawl | **OPEN** | same 33-site evidence |
| T7 event plumbing ×4 | **OPEN** | 4 buses, triplicated AGUI decode (`useAgentRun` ×2, voice ×1) |
| T8 trust chain | **MOSTLY FIXED** | gate fails closed (`a0b1ce6`); preflight fail-open is documented defence-in-depth |
| T9 duplicate skills | **OPEN** | DB registry + agent-ts filesystem both live |
| T10 voice lab | **RESOLVED** | voice-s2s migration |
| T11 arbiter discards unloads | **OPEN** | `.catch(() => null)` fire-and-forget at `arbiter.ts:226,309,570,607` |
| T12 dead weight | **OPEN** | `apps/model-tray/` still 5.4 GB untracked |

## New threads the swarm found (first-grade-engine didn't cover)

- **T13 verification was red repo-wide** — RESOLVED today (above).
- **T14 dead UI, 19,156 lines / 109 files** — whole abandoned generations
  (plugins system 2.5k, settings drawer, panes/settings, panes/hardware,
  panes/inference ~2.4k, panes/capabilities ~1.8k, sidebar, canvas, inspector,
  v2/ui, most of audio/, voice-lab). Unmarked; three dirty files in the tree
  right now are edits *inside* dead subtrees (`HardwareSection`, `InputSection`,
  `DiskTab`) — work is being spent on unreachable code.
- **T15 API surface untested**: 113 route files, 4 with tests; the 922-line
  `chat/route.ts` is untested and carries console.logs. No fake agent-ts
  fixture exists.
- **T16 dual thread stores**: localStorage (`lib/chat/helpers.ts`) vs SQLite
  threads (`db.ts`), hand-synced.
- **T17 history degradation**: `wireToPiMessages` also drops assistant
  tool-call history — multi-turn context degrades (distinct from T1).
- **T18 agent-ts dead build path**: `noEmit: true` but launcher prefers
  `dist/server/main.js` — always falls back to tsx.
- **T19 vLLM pyenv dangling**: declared, locked, nothing launches or calls it.
- **T20 offline voice preset resolves to null** (`resolve-voice-route.ts:90,98`
  empty preference lists).
- **T21 no CI, evals stale**: last eval run 2026-05-15; harness needs live
  services (llama-swap, workspace client), no hermetic mode. `verify` is
  CI-ready but nothing runs it.
- **T22 tree hygiene relapse**: the dirty tree again mixes ≥4 workstreams
  (models installer, offline scanner, command palette, chat) — Phase 0's
  lesson didn't stick. Also `components/` has zero rendering tests and
  `ChatSurface.tsx` is 1,305 lines; settings UI exists 3 ways.

---

## The iterated plan

Vision unchanged, and the swarm re-confirmed it: **one spine, many surfaces** —
one router, one runtime, one ledger, one event codec, one gate; every surface a
client. The 2026-07-03 phasing was right; this updates contents and order.

### Phase 0 — Land the tree clean (NOW, ~half day)
1. Split the dirty tree into commits: models-installer + offline-scanner +
   ollama-pull (one feature), V2CommandPalette, chat-surface changes, the rest.
   Revert the three dead-subtree edits (T14) instead of committing them.
2. Delete `apps/model-tray/` (5.4 GB) — **needs owner approval** (destructive).
3. Decide T14: delete the 19,156 dead lines (script output is the checklist) or
   mark them `// @deprecated-dead` as a first pass. Deletion is reviewable now
   that `dead-components.ts` exists and `verify` is green.

**Done when:** `git status` clean, `bun run verify` exit 0 on every commit.

### Phase 1 — Reconnect the brain (days, correctness first)
1. **T1**: add `system`/`prompt_prefix` to the agent-ts run request; Next passes
   its assembled prompt; agent-ts uses it as `initialState.systemPrompt`,
   bootstrap files as fallback only. Remove the inject-as-system-message hack.
2. **T17**: replay assistant tool-call history in `wireToPiMessages`.
3. **T11**: check `doUnload` results at the four fire-and-forget sites.
4. **T20** (small): make the offline voice preset resolve local providers or
   remove the preset.
5. Add the prompt round-trip eval case to the existing harness (T21 start).

**Done when:** a thread with memory + persona demonstrably changes model output;
verify green.

### Phase 2 — One router (~a week)
Unchanged from 2026-07-03, plus confirmed targets: kill `freeTier.ts` (zero
importers), route all 33 `OLLAMA_BASE_URL` reads through `resolveProviderUrl`,
one env vocabulary, Next sends complete llm config (agent-ts validates only).

**Done when:** adding an engine touches one file; `rg OLLAMA_BASE_URL` outside
resolvers is zero — enforced by a new contract-check rule.

### Phase 3 — One ledger, one wire (~a week)
Unchanged, plus: merge the dual thread stores (T16) into the SQLite record;
one AGUI codec consumed by `useAgentRun`, `use-voice-session`, agent-ts
`translate`; one SSE framer/parser; canvas bus onto workspace bus; one client
run controller for chat + voice; split `db.ts` last.

**Done when:** event-schema change breaks exactly one module; kill -9 either
process and the UI shows truth on restart.

### Phase 4 — The elite bar (ongoing)
1. **CI gate**: `bun run verify` + eval floor (agent-work ≥ recorded 91%
   baseline) in GitHub Actions or a pre-push hook. Hermetic eval mode so it
   runs without llama-swap/workspace clients.
2. **Decompose the gods**: `chat/route.ts` (922→ gateway modules <300 lines),
   `ChatSurface.tsx` (1,305 → SURFACE.md's decomposition, which is still the
   right target), `db.ts` split (lands in Phase 3).
3. **Test the surface**: fake agent-ts SSE fixture → chat-route invariants;
   middleware auth matrix; component infra (happy-dom) for the pane adapters;
   one Playwright chat golden path next to the voice specs.
4. **Numbers as gates**: TTFT, tool round-trip, voice loop latency, model-swap
   time — surfaced in /v2/system, tracked per commit.
5. Resolve T18/T19 (dead build path, vLLM env: wire it or drop it).

### What NOT to do (carried forward, still binding)
- No shell swap. No new surfaces/providers before Phases 1–2.
- Don't blend the two skills systems — filesystem canon, `lib/skills` becomes
  the UI/index over it.
- Don't edit files inside dead subtrees; run `dead-components.ts` first.
- npm/npx remain banned; bun 1.3.4 pin stands (bare `bun test` caveat above).

### Open decision points (owner calls)
1. Delete `apps/model-tray/` (5.4 GB, destructive)?
2. T14: delete 19k dead lines now, or mark-and-defer?
3. Dirty tree: who lands the split commits (agent with commit approval, or owner)?
4. Next execution target after Phase 0: T1 (recommended — the brain is severed)
   or T14 cleanup first?

---

## Execution log — 2026-07-17 (autonomous run, owner-approved)

Phase 0 + Phase 1 executed same-day by agent swarm. Tree clean, `bun run verify`
exit 0 at HEAD (`afd911f`).

**Phase 0** (7 commits, `c0979e2` → `25c8c40`): dirty tree split into
test-isolation / verify-gate / models-installer / command-palette / chat-surface /
plugins-fix / docs commits. `apps/model-tray/` (5.4 GB) deleted. Dead-subtree
edits reverted; `DiskTab.tsx` hunk reapplied (type-required by the installer
commit) then deleted with T14.

**Phase 1** (5 commits, `25c8c40` → `afd911f`):

| Commit | Thread | What landed |
|---|---|---|
| `1233c19` | T4 tail | agent-ts default port 4244 |
| `bb398ba` | **T1 + T17 FIXED** | `system_prompt` wire field → `initialState.systemPrompt` verbatim; bootstrap = standalone-dev fallback; injection hack removed from `lib/llm/systemPrompt.ts`; `wireToPiMessages` replays tool calls/results; 4 new loop tests incl. prompt round-trip. agent-ts 33/33. |
| `175bc1a` | **T11 FIXED** | all four fire-and-forget `doUnload` sites check outcomes; honest deny/evict-failed events; 7 new arbiter tests |
| `d38cf76` | **T20 FIXED** | offline preset resolves `qwen-omni-local` only — never cloud |
| `afd911f` | **T14 FIXED** | 108 files / 19,134 lines of dead UI deleted; `NotesPaneAdapter.test.ts` spared; `apps/model-tray` doc refs allowlisted |

T-score after this run: **FIXED** T1, T4, T8(mostly), T10, T11, T13, T14, T17, T20 ·
**OPEN** T2, T3, T5, T6, T7, T9, T12 (tree hygiene is now clean; thread stays as
the standing risk), T15, T16, T18, T19, T21, T22.

Notes for the next run:
- T1 follow-up: deck only sends `user`/`assistant` client messages today —
  DB-persisted tool calls need mapping in `chat/route.ts` to feed the new
  replay path (wire-ready, not yet fed).
- T20 adjacent: the `local` voice preset is also cloud-only despite its
  "privacy-preserving" description — candidate for the same honest treatment.
- T11 residuals (restore-liveness gap, ticket-less OOM wedge visibility) noted
  in the arbiter commit; not VRAM-tracking desyncs.
- Next phase per plan: Phase 2 — one router (`lib/engine/resolve.ts`, kill
  `freeTier.ts`, 33 `OLLAMA_BASE_URL` sites → resolver).

## Execution log 2 — Phase 2 (one router), 2026-07-18

Four-agent wave, gate green at HEAD (`bd1eb28`).

| Commit | Thread | What landed |
|---|---|---|
| `f29297d` | T2/T3-adjacent | agent-ts obeys deck-resolved `llm` config verbatim — validate + 1.5s availability probe only; structured `llm_unavailable`/`llm_model_unserved` errors; no snap, no re-derivation. agent-ts 40/40 (+7) |
| `c681d10` | **T2 FIXED** | `lib/engine/resolve.ts`: one `resolveModelRoute()` (request → binding → settings → LLM_* env → default). Chat, title-gen, plugin-maker, generative-ui consume it; providers.ts → shim. 17 resolver tests |
| `19c7f7c` | **T6 FIXED** | 13 `OLLAMA_BASE_URL` bypass sites → `resolveProviderUrl` (per-request; Settings edits apply live). contract-check rule [5] bans new bypasses forever |
| `bd1eb28` | T2 cleanup | freeTier.ts + free-tier routes + 4 lying DeckPrefs fields (+2 write-only) deleted; ModelsPane 712→248 lines; orphaned cloudProviders.ts + useCatalog.ts deleted |

Follow-ups for the record:
- providers.ts shim importers remaining on the legacy sync API: `app/api/backend/route.ts`, `app/api/newsroom/rewrite/route.ts`, `app/api/tools/glyph-eval/route.ts`, `lib/inference/catalog.ts`, `lib/inference/text/register.ts`, `lib/llm/index.ts` — migrate to `lib/engine` in a later pass, then drop the shim.
- Resolver judgment calls (documented in commit c681d10): settings-chain URL everywhere incl. default; binding > env uniformly (title-gen used to invert); ultimate fallback model qwen3:0.6b; legacy runtimeOverride sits in the binding tier.
- Next: Phase 3 — one ledger, one wire (agent-ts drops runs.db; one AGUI codec; one SSE framer/parser; merge thread stores; one client run controller; split db.ts last).

## Execution log 3 — Phase 3 (one ledger, one wire), 2026-07-18

Five parallel agents + parent integration + db-split agent. Gate green at HEAD
(`37e5537`), 1001 bun tests + 44 agent-ts tests.

| Commit | Thread | What landed |
|---|---|---|
| `178e634` | **T7 wire** | `lib/agui/sse.ts` — the one SSE framer+codec (parent-pinned); agui/stream rewritten (+round-trip test), chat SSE proxy, workspace/commands, resource/events, code/stream, onboarding/run migrated; non-AG-UI SSE users documented; LLMResolved now mapped into the ledger |
| `f81a03d` | **T7 codec + T3 cancel** | all 3 client decoders collapse onto SSEParser; `useRunController` — one runId/active/cancel owner for chat+voice, exactly one cancel POST per run; useThreadStream/useRunsData off EventSource. 16 new tests |
| `e922dad` | **T3 FIXED** | agent-ts `runs.db` + store.ts deleted — in-memory only, no replay across restart by design; deck `reconcileOnBoot` fails dead-process runs; AGUI conformance test proves every emitted event satisfies the deck union. 44/44 |
| `9d163e6` | **T16 FIXED** | SQLite is the one thread store; localStorage mirror purged on mount; `/api/threads` survives (+rename), `/api/agui/threads` deleted; renames now persist. 13 route tests |
| `eb4ba20` | **T7 buses** | canvas bus → workspace bus topics (`lib/workspace/canvas.ts`); `lib/canvas/` deleted; command-relay kept as the server command bridge. 4 buses → 2 |
| `37e5537` | **T5 FIXED** | db.ts (1,416 lines) split into `db/` domain stores over one shared connection; barrel keeps all 81 exports; byte-exact, zero behavior change |

Follow-ups for the record:
- `payload.property.test.ts` flaked once (fast-check "Unterminated string"
  GLYPH counterexample) — seen twice now; latent codec edge case, next bug hunt.
- agent-ts emits InterruptRequested with an untyped `data` bag — align to the
  canonical shape or extend the type (client currently handles both).
- 4 non-AG-UI SSE users kept payload frames (workspace/commands, resource/
  events, code/stream, onboarding/run) — decide canonical deck event types or
  bless them as-is.
- providers.ts shim importers (6 files) still on the legacy sync API.
- Next: Phase 4 — the elite bar (CI gate, god-file decomposition: chat/route.ts
  + ChatSurface.tsx, surface testing, latency dashboard, T9/T18/T19).

T-score: **FIXED** T1,T2,T3,T4,T5,T6,T7,T8(mostly),T10,T11,T13,T14,T16,T17,T20.
OPEN: T9, T12 (standing hygiene), T15, T18, T19, T21, T22.
