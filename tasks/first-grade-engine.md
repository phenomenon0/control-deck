# First-grade local LLM engine — big-brother review & decoupling plan

Generated: 2026-07-03. Branch: master @ dcb950d + dirty tree (~967 ins / 29 files).
Method: four parallel deep audits (LLM engine path, cross-module coupling, voice
pipeline + working-tree diff, debt scan), key claims spot-verified by hand.

---

## Verdict

The cockpit is real and the design is sound (the UI pass already proved that at
7.9/10 with one objective defect). The **engine spine is not**. Chat works, but
the deck's headline features — memory, skills, per-thread persona — are built,
rendered into a system prompt, and then **silently thrown away** before the
model ever sees them. Model routing is resolved in four-to-five competing
systems. Every run is double-booked in two SQLite ledgers that never reconcile.
A dead Agent-GO client still gates app boot on a port nothing serves.

The path to "first-grade local LLM engine" is not more features. It is **one
spine**: one prompt pipeline, one router, one ledger, one event codec, one
gate — with every surface (chat, voice, browser, native, canvas) as a client of
that spine, never a fork of it.

---

## The trouble threads (ranked)

### T1 — The prompt pipeline is severed (functional bug, highest priority)

`app/api/chat/route.ts:478-488` assembles the system prompt from
`renderMemoryForPrompt()`, `renderSkillIndex()`, workflow reference, the
thread's custom `system_prompt`, and the voice-mode prompt, then injects it as
a `role:"system"` message. But `apps/agent-ts/src/server/loop.ts:522-557`
(`wireToPiMessages`) only converts `user`/`assistant` roles — line 555 says it
outright: *"system / tool messages are skipped."* agent-ts instead uses a
hardcoded `SYSTEM_PROMPT` + `readBootstrap()` (SOUL.md/USER.md/MEMORY.md read
off disk) at `loop.ts:146-148`, verified by hand.

**Net effect: memory, skill index, persona, and voice prompts never reach the
model on the canonical path.** Everything downstream of this (the Next-side
skills system, memory rendering, per-thread personas) is currently inert
scaffolding.

### T2 — Five-way model routing

Four independent "which LLM?" systems merge inside one request, plus a
half-dead client store:

1. `lib/llm/providers.ts` — `LLM_*` env trio + in-memory `runtimeOverride`.
2. `lib/hardware/providers/*` + `lib/hardware/settings.ts` — separate engine
   table, **different env names** (`OLLAMA_BASE_URL`…), DB-backed overrides.
3. `lib/inference/text-binding.ts` — slot-binding overlay (`text::primary`),
   whose own docstring admits the split.
4. `apps/agent-ts/src/server/llm.ts:27-92` — its own `PROVIDER_PRESETS` and env
   precedence; re-resolves and re-snaps the model against `/v1/models` even
   when Next already resolved it.
5. `DeckPrefs` client store — `routeMode`/`cloudProvider`/`cloudModel` are
   **disconnected from the send path** (`ChatSurface.tsx:341` reads only
   `prefs.model`); `lib/llm/freeTier.ts` (571 lines) has zero importers outside
   its own status routes.

`route.ts:531-546` documents "two storage layers meet here" — it's actually
four-to-five. Adding one new engine today means touching up to four files.

### T3 — Two run ledgers, two cancel paths, no reconciliation

- Next's `deck.db` (`lib/agui/db.ts`) and agent-ts's `runs.db`
  (`apps/agent-ts/src/server/store.ts:185-209`) both persist runs/events,
  correlated only by runId convention; `route.ts:691-699` logs divergence but
  doesn't reconcile. Each side reaps/aborts independently.
- Client-side, `useAgentRun.stop()` and `use-voice-session.interrupt()`
  (`lib/voice/use-voice-session.ts:1067-1076`) each POST the same cancel
  endpoint from separately-tracked run ids, glued only by ChatSurface manually
  threading `clientRunId` into both.

### T4 — The Agent-GO ghost

Replaced by agent-ts (:4244), but: `lib/agentgo/client.ts:8` still defaults
to :4243; `components/panes/AgentGoPane.tsx` is still a reachable workspace tab
talking to a port nothing serves; `app/api/preflight/status/route.ts:24` gates
boot (`required: true`) on the stale :4243 default; `apps/agent-ts/src/server/main.ts:19`
itself defaults to :4243. Three files disagree on the port of the one true runtime.

### T5 — `lib/agui/db.ts` is a god module

1,356 lines, 37 direct importers. Owns runs/events/threads/messages **and**
settings, approvals, plugin state + cache, invocation telemetry, and the MCP
server registry. Every subsystem's persistence lives in one blast radius.

### T6 — Config sprawl defeats the Settings UI

`resolveProviderUrl` (`lib/hardware/settings.ts:51-68`) exists precisely to
centralize this, and is bypassed by 10+ hardcoded
`process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"` sites (onboarding
orchestrator, executor, ollama-probe, embedding/vision invokes, system stats…).
`VOICE_CORE_URL`/host/port is redeclared 11+ times with no resolver at all.
**A user changing the Ollama URL in Settings silently doesn't affect onboarding,
probes, or several invoke paths.**

### T7 — Event plumbing multiplied

- Four pub/sub buses: `lib/agui/hub.ts`, `lib/workspace/bus.ts`,
  `lib/workspace/command-relay.ts`, `lib/canvas/bus.ts` — same pattern, four
  implementations.
- SSE framing hand-rolled in **seven** route handlers with drifted conventions.
- Client stream parsing reimplemented across 14 files.
- AGUI event decoding is **triplicated**: `useAgentRun.ts:427-519`
  (`dispatchSSEEvent`), the new `captureEvent` closure (`useAgentRun.ts:656-674`),
  and voice's own inline SSE switch (`use-voice-session.ts:756-821`, which
  comments that gate.ts and agent-ts shape the same payload differently).
  Schema drift must be fixed in three places.

### T8 — Trust-chain fail-opens and an overclaiming sandbox

- `lib/approvals/gate.ts:120-151` **fails open** (auto-approves) if section
  resolution or the approval DB write throws.
- `apps/agent-ts/src/server/loop.ts:443-448` preflight policy check fails open
  to `allow` on any network error — a second fail-open node in the same chain.
- Risk interpretation is split between `lib/tools/policy.ts:70-173` and
  `lib/approvals/gate.ts:63-80`, with subtly different rules over the same
  manifest fields.
- `lib/tools/code-exec/sandbox/linux.ts:1-13` claims namespace + filesystem
  isolation; `buildSpawnOptions()` provides neither (only network isolation
  actually uses `unshare`). Executed code sees the full host filesystem.

### T9 — Duplicate skills systems

`lib/skills/*` (DB registry → prompt injection, currently inert due to T1) vs
`apps/agent-ts/src/context/skills.ts` + `domain-skills.ts` (filesystem scan →
native tools, the one the model can actually reach). Two implementations of the
same idea on either side of the process boundary, no shared source of truth.

### T10 — Voice Lab half-landed; dead instrumentation

- Six built components (`LabControls/LabInput/LabConsole/LabTimeline/LabReport/LabPresetIO`,
  1,032 lines) are never mounted; `LabStoreProvider` is mounted nowhere, so
  wiring them in today would throw (`lib/voice-lab/store.tsx:199`).
- `apps/voice-core/src/voice_core/timing.py` (new) is imported nowhere — the
  helper it was written to be got hand-copied into five engines instead.
- `enable_timing` is plumbed four layers deep but dead on both TTS engines;
  `JUNCTIONS.SRV_TTS_PHRASE` (`latency-probe.ts:76`) references a frame no
  server code emits.
- `chatterbox.py:52-58` returns 0.2 s of **silence** instead of erroring when
  synthesis isn't wired — a "working" engine that produces no speech.

### T11 — Resource arbiter discards unload results

`lib/resource/arbiter.ts:587` (TTL sweep), `:206`, `:289` (`reportOom`), `:550`
fire `doUnload` and delete the reservation regardless of outcome → tracked-free
VRAM can desync from the GPU. (`evict()` does it right; four paths don't.)

### T12 — Working tree entangles five workstreams; dead weight

The dirty tree mixes: (1) voice timing instrumentation, (2) lab overrides,
(3) runId/cancel/approval plumbing, (4) the `safeMarkdownHref` XSS-adjacent fix,
(5) onboarding-partial + UI polish. Plus `apps/model-tray/` — 5.4 GB of
untracked, unreferenced Tauri build output (pake-fit already recommended
deleting it).

---

## Tightened vision

Current README pitch: *"one cockpit for every surface"* — chat, code, terminal,
browser, native, music, vision, 3D. That breadth is the moat, but it reads as
sprawl because internally each surface forked the spine instead of riding it.

**Tightened: one spine, many surfaces.**

> Control Deck is a local-first LLM **engine** with a cockpit on top.
> One router decides which model serves a request. One runtime executes the
> loop. One ledger records it. One event codec streams it. One gate approves
> it. Every surface — chat, voice, browser, native, canvas, music — is a
> *client* of that spine. A feature that doesn't ride the spine doesn't ship.

Canonical decisions (conflicts resolved, not averaged — Rule 7):

| Question | Canon | Loser (flagged for cleanup) |
|---|---|---|
| Runtime | **agent-ts (:4244)** is the only place a model loop runs | Agent-GO client/pane (delete); dojo & plugin-maker direct `generateText` (route through the resolver, or explicitly mark as spine-exempt utility calls) |
| Prompt assembly | **Next assembles, agent-ts obeys** — bootstrap files are fallback for standalone dev only | agent-ts hardcoded `SYSTEM_PROMPT` as primary |
| Model resolution | **One resolver module**, consumed by both processes | providers.ts/hardware/text-binding/agent-ts quadrople; freeTier.ts; dead DeckPrefs fields |
| Run ledger | **Next `deck.db` is the record**; agent-ts holds only in-flight state | agent-ts `runs.db` as a second ledger |
| Skills | **Filesystem SKILL.md + agent-ts tools** (they actually reach the model); `lib/skills` becomes a UI/index over the same files | DB-registry-as-prompt-injection |
| Shell | **Electron stays** (pake-fit settled it); Pake only as thin monitor/companion | any wholesale shell swap |

---

## The plan

### Phase 0 — Land the tree clean (~half a day)

1. Split the dirty tree into five commits:
   **A** `safeMarkdownHref` (security, ships alone) · **B** runId/cancel/approval
   plumbing · **C** onboarding-partial + UI polish (split the behavior change
   from the CSS if reviewability matters) · **D** voice-core timing
   instrumentation · **E** Voice Lab UI + harness.
2. Before E lands: either mount `LabStoreProvider` + the six orphan components
   or prune them; adopt `timing.py` in the five engines or delete it; remove the
   never-emitted `SRV_TTS_PHRASE` junction or implement TTS phrase timing.
3. Delete `apps/model-tray/` (5.4 GB) and gitignore the pattern.

**Done when:** `git status` clean, each commit passes typecheck + tests.

### Phase 1 — Reconnect the brain (days) — *correctness first*

1. **Fix T1:** add a `system` (or `prompt_prefix`) field to the agent-ts run
   request; Next passes its assembled prompt; agent-ts uses it as
   `initialState.systemPrompt`, falling back to bootstrap only when absent.
   Remove the inject-as-system-message hack in `lib/llm/systemPrompt.ts`.
2. **Fix T4:** one shared port constant/env (`AGENT_TS_PORT`), fix
   `preflight/status/route.ts:24`, `agent-ts main.ts:19`, delete
   `lib/agentgo/{client,useAgentGoRun}` dead exports + `AgentGoPane` (keep
   `retryingFetch` in a neutral util).
3. **Fix T8:** decide fail-closed (recommended: deny with a clear recovery
   message) at `gate.ts` and the agent-ts preflight; merge `policy.ts` /
   `gate.ts` risk interpretation into **one** decision function both call.
   Make the sandbox docstring match reality; open a ticket for real fs/PID
   isolation.
4. Fix T11 (check `doUnload` results at all four sites) and the chatterbox
   silent-audio stub (raise instead of emitting silence).

**Done when:** a thread with memory + custom persona demonstrably changes model
output (add an eval case asserting prompt round-trip — the eval harness already
exists); preflight reflects true service state; a failed approval write denies
instead of approving.

### Phase 2 — One router (~a week)

1. Create `lib/engine/resolve.ts`: single `resolveModelRoute()` with explicit
   precedence — per-request pick → slot binding → settings (DB) → env →
   default — and **one** env vocabulary. Consumed by chat, threads title-gen,
   dojo, plugin-maker, embedding/vision invokes.
2. Next sends a **complete** llm config to agent-ts; `resolveLLM()` shrinks to
   validate + availability-check, no re-derivation (presets stay only for
   standalone `agent-ts` dev runs).
3. Kill `freeTier.ts` and the dead `DeckPrefs` fields
   (`routeMode`/`remoteModel`/`cloudProvider`/`cloudModel`) — or wire cloud
   picking through the `providerId` path if cloud routing is wanted; don't keep
   UI that lies.
4. Route every base-URL read through `resolveProviderUrl` (Ollama, 10+ sites)
   and one voice-core URL module (11+ sites).

**Done when:** adding a new local engine touches one file; changing the Ollama
URL in Settings affects *every* consumer; `rg 'OLLAMA_BASE_URL|VOICE_CORE_'`
outside the resolvers returns zero app-code hits.

### Phase 3 — One ledger, one wire (~a week)

1. **Ledger:** `deck.db` becomes the record; agent-ts drops `runs.db` and keeps
   only its in-memory in-flight map (events stream through as today). One
   reaper. Crash of either process converges to truthful run state in the UI.
2. **Event codec:** one typed AGUI codec module (schema + parse + serialize)
   consumed by `useAgentRun`, `use-voice-session`, and agent-ts's `translate` —
   collapsing the triplicated parsing.
3. **Transport:** one server SSE helper (heartbeat, `event:` framing, backoff
   hints) replacing seven hand-rolled framers; one client SSE/NDJSON parser
   replacing the 14 ad-hoc consumers; canvas DOM bus migrates onto the
   workspace bus (4 buses → 2: server hub + workspace relay).
4. **Run control:** one client-side run controller owning
   `runId`/active-state/cancel; ChatSurface and voice both consume it —
   killing the dual cancel path.
5. Split `lib/agui/db.ts` into domain stores (runs+events, settings, approvals,
   plugins, mcp) over one shared connection — mechanical, do it last when
   imports have already narrowed.

**Done when:** an event-schema change breaks exactly one module; `kill -9`
either process and the UI shows truth on restart; cancel works identically from
chat and voice surfaces.

### Phase 4 — The first-grade bar (ongoing, measurable)

1. Decompose `app/api/chat/route.ts` (917 lines) into gateway modules — auth /
   resolve / proxy / publish — each under ~300 lines.
2. Consolidate skills on the filesystem system (canon per the table above);
   `lib/skills` registry becomes an index/UI over the same SKILL.md files.
3. Single poll-cadence/idle-policy owner in `lib/resource/` (the dcb950d perf
   fix touched 8 files across 5 modules for one concern — make it one knob).
4. **Numbers as gates:** time-to-first-token, tool round-trip latency, voice
   loop latency (the harness exists), model-swap time — surfaced in the
   hardware pane and tracked per commit; the existing `eval:*` suites run as a
   CI gate.

**Done when:** the engine has a dashboard of trending latencies, an eval gate
in CI, and survives restart-chaos testing.

### What NOT to do

- No shell swap (pake-fit settled it: CDP loss is a hard blocker; Pake only as
  a thin companion later).
- No new surfaces or providers until Phases 1-2 land — every addition today
  multiplies across 4 routing systems and 3 event decoders.
- Don't blend the two skills systems "for compatibility" — pick the canon,
  migrate, delete.
