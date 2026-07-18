# One Spine, Many Surfaces: A Week's Debt Paid in a Day

*2026-07-17 — Control Deck engineering log*

Control Deck is a local-first AI cockpit: one shell over chat, voice, terminal,
browser, native desktop control, and a fleet of local models. The design docs
were never the problem. The problem was that every surface had quietly forked
the engine instead of riding it — five competing model routers, two run
ledgers, four event buses, and a prompt pipeline that assembled memory, skills,
and persona on every request and then **silently threw them away** before the
model ever saw them.

This week we stopped adding features and paid down the debt. An eight-agent
exploration swarm mapped the whole repo; builder agents did the work; a new
verification gate refereed every change. The scoreboard:

- **13 commits**, tree clean, `bun run verify` green at HEAD
- **928 + 33 tests passing** (was: 48 failures + 20 errors hidden in a red suite)
- **19,134 lines of verified-dead UI deleted** (108 files)
- **5.4 GB** of abandoned Tauri build output reclaimed
- **9 of 22 trouble threads closed**

## Phase 0 — You Can't Fix What You Can't Check

The most important finding wasn't a bug — it was that the question "did I break
something?" had no answer. The test suite was red from cross-file mock leaks
(`mock.module()` registrations are process-global and un-revertable on bun;
converting to `spyOn` + restore fixed 48 phantom failures), the vendored
llama.cpp checkout was being swept into test runs, and the agent runtime's 29
tests were undiscoverable from the repo root.

So the first deliverable was a gate: one `bun run verify` — stack-drift doctor,
cross-file contract checks, typecheck, lint, scoped tests, agent runtime tests.
Plus two new instruments: `contract-check.ts`, which fails if the 50 bridge
tools drift from their executor/schemas/manifest, if any file disagrees about
the agent's port, if model bindings reference dead providers, or if docs cite
paths that no longer exist — and `dead-components.ts`, an import-graph
reachability reporter that made the 19k lines of dead UI a checklist instead of
an accusation.

Then the tree itself: seven logical commits, the 5.4 GB `model-tray` skeleton
deleted, and a dirty working tree that had been mixing four workstreams finally
landed clean.

## Phase 1 — Reconnecting the Brain

The headline bug deserved its own commit message: **the deck's headline
features were inert scaffolding.** Memory, skills, per-thread persona, voice
prompts — all assembled with care, sent as a `system` message, and dropped by a
function that only converted `user` and `assistant` roles. The fix is the
canon's one sentence: *Next assembles, agent-ts obeys.* A `system_prompt` wire
field now carries the assembled prompt straight into the runtime's
`initialState.systemPrompt`, the injection hack is deleted, and multi-turn tool
history replays instead of vanishing. A round-trip test asserts the model sees
the deck's prompt byte-for-byte.

Same wave, three more threads closed: the VRAM arbiter's four fire-and-forget
unload sites now check outcomes instead of desyncing the ledger from the GPU;
the "offline" voice preset now honestly resolves to the local Qwen-Omni engine
(never silently to cloud); and the 19k lines of dead UI left the tree.

## Looking Forward

The threads that remain are the structural ones, and they're sequenced:

- **Phase 2 — One Router.** One `resolveModelRoute()` with explicit precedence
  (request pick → slot binding → settings → env → default), one env vocabulary,
  and the 33 hardcoded `OLLAMA_BASE_URL` reads collapsed into a single
  resolver. Done-when: adding a new local engine touches one file.
- **Phase 3 — One Ledger, One Wire.** `deck.db` becomes the only run record;
  one typed AG-UI event codec consumed by chat, voice, and the runtime; one
  SSE framer instead of seven; the dual thread stores merged. Done-when: kill
  -9 either process and the UI shows truth on restart.
- **Phase 4 — The Elite Bar.** The gate runs in CI with eval floors; the three
  god-files (`chat/route.ts` at 922 lines, `ChatSurface.tsx` at 1,305,
  `db.ts` at 1,388) decompose; and time-to-first-token, tool round-trip, voice
  loop latency, and model-swap time trend on a dashboard per commit.

The method mattered as much as the fixes: swarm to map, gate to referee, small
agents on disjoint file sets, commits per workstream. Every "done" below a
green `verify` is negotiable; everything above it is true.

One spine, many surfaces. The spine is connected now — next we make it singular.
