# Plan: Voice-core final integration verification + legacy cleanup
Generated: 2026-04-27 (later session)

## Context

- Voice-core sidecar (port 4245) is up; T3_CPU engines available: moonshine-tiny, sherpa-onnx-streaming, kokoro-82m, sherpa-onnx-tts, silero.
- All ~844MB of CPU-tier model weights pulled into `models/voice-engines/`.
- Deck routes (`/api/voice/stt`, `/api/voice/tts`, `/api/voice/health`) verified end-to-end via curl.
- `useVoiceChat` dead WebSocket path removed; bindings file migrated from retired `voice-api` to `voice-core`.

What remains: verify the **deck UI itself** actually transcribes + speaks (browser-level test, not curl), and clean cosmetic legacy references.

## Phases

- [ ] **Phase 1 — Browser-level smoke test of chat surface**
  - [ ] 1.1: Navigate browser-harness to deck (http://localhost:3333)
  - [ ] 1.2: Open chat, find mic button, screenshot, verify it's enabled (not greyed)
  - [ ] 1.3: Verify VoicePane (audio modality) renders TTS engine picker with 3 options
  - [ ] 1.4: Trigger TTS via VoicePane "speak" with hardcoded text → confirm audio plays
  - **Done when:** screenshots show enabled UI + at least one playback succeeds (network panel shows 200 from /api/voice/tts)

- [ ] **Phase 2 — VoicePane TTS engine picker actually changes engine**
  - [ ] 2.1: Read VoicePane to confirm engine state is plumbed into request
  - [ ] 2.2: If not plumbed, add `engine` to request body in default `synthesizeViaVoiceRoute`
  - [ ] 2.3: Re-test by switching engine → verify X-TTS-Provider header reflects switch
  - **Done when:** picking sherpa-onnx-tts vs kokoro-82m yields measurably different audio output

- [ ] **Phase 3 — Cosmetic legacy cleanup (optional, low-risk)**
  - [ ] 3.1: Rename `lib/inference/voice-engines/` → `lib/inference/voice-core/` and update imports
  - [ ] 3.2: Re-run typecheck; commit if clean
  - **Done when:** typecheck passes and no `voice-engines` directory remains
  - **Decision rule:** if rename touches >15 files or breaks anything, abort and leave dir alone

## Decision Rules (pre-answered)

- If `/api/voice/tts` returns 502 in browser-harness: re-check binding file, do NOT rebuild voice-core.
- If a TTS engine is unavailable but UI shows it: leave UI as-is (engines lazy-load on first use).
- If browser-harness can't connect: stop and notify user (no destructive action).
- If Phase 2 reveals engine isn't plumbed: implement minimal patch in `synthesizeViaVoiceRoute`, do not refactor the TTS pipeline.
- If Phase 3 rename hits >15 files: abort, leave directory name as-is.

## Escalation Triggers

- Browser-harness daemon won't start → STOP, surface to user.
- Voice-core dies mid-test → STOP, do not auto-restart unless user approves.
- TTS hangs >30s → STOP, surface logs, do not retry blindly.

## Checkpoints

- After 1.4: write `tasks/phase1_DONE` with TTS round-trip latency.
- After 2.3: write `tasks/phase2_DONE` with provider header verification.
- After 3.2: write `tasks/phase3_DONE` with files-modified count.

## Timeout Budget

- HTTP probes: 30s, retry 3x.
- Browser-harness navigation: 30s, retry 2x.
- TTS round-trip: 10s.
- File ops: 10s, retry 2x.

## Size estimate

- Phase 1: 0 files modified (verification only)
- Phase 2: 1–2 files modified (VoicePane.tsx + maybe useVoiceChat.ts)
- Phase 3: ~6 files modified (rename + import updates), 0 created, 0 deleted

## Noticed but out of scope

- chatterbox is unavailable on Linux (~2.2GB weights, optional anyway).
- openWakeWord lacks cp312 wheels; wake-word feature blocked unless we drop to cp311 or wait upstream.
- `lib/inference/voice-engines/sidecar-url.ts` filename is misleading (it points to voice-core); covered by Phase 3.

---

# Plan: Final Deferred Items — Voice Cancellation + relinkArtifactRun Cleanup (PRIOR PLAN — ARCHIVED)
Generated: 2026-04-27

## Context
Two items were deferred from the original CONTROL DECK hardening plan and remain
open after the persist-approvals (e9c374e), executor split (c4dc75a), and
live-removal (cd47211) commits.

1. **Voice cancellation propagation** — `interrupt()` in `use-voice-session.ts`
   already does most of the work (aborts the local fetch via
   `handle.chatAbort.signal`, POSTs `/api/chat/runs/:runId/cancel`, tears
   down streaming TTS, drains audio output). What's still rough:
   - The SQLite `runs` row is left as `running` after a user interrupt;
     no `endRun` is called from the cancel path.
   - `RunError { message: "aborted" }` from agent-ts looks identical to
     a real error in the chat UI consumer.
   - The truncated assistant message stays in `conversationRef.current`
     and gets sent back into the next turn's LLM context.

2. **`relinkArtifactRun` legacy fallback** — Phase 2 of the original plan
   shipped canonical AG-UI runIds (Next allocates, agent-ts honours them
   via `req.run_id`). The `setAgentRunId` / `getAgentRunId` /
   `relinkArtifactRun` reconciliation path is now a no-op on the happy
   path (the `UPDATE runs SET agent_run_id = ?` writes the same id, and
   the artifact row already has the canonical runId). Approve / reject
   still depend on `getAgentRunId(runId) ?? runId` which can return null
   in race conditions but resolves correctly via the fallback every time.

## Scope decision
Targeted polish, not a rewrite. Two independent commits.

## Tradeoffs

**For voice cancellation:**
- (A) **Soft polish** — flag the run row as failed-with-reason="aborted"
  on cancel, suppress the "aborted" RunError toast in the UI, drop the
  truncated assistant message from the conversation ref. Low risk, low
  surface, fits one commit.
- (B) **Deep refactor** — introduce a structured `RunCancelled` event,
  thread it through every consumer. Better long-term, multi-commit, and
  the original plan explicitly deferred this larger surface.

→ Going with (A). The AG-UI event protocol can absorb a
`RunCancelled` event later without breaking (A).

**For `relinkArtifactRun`:**
- (A) **Hard cleanup** — drop `setAgentRunId`, `getAgentRunId`,
  `relinkArtifactRun`, and the `agent_run_id` SQLite column. Cleanest,
  but schema changes are an escalation trigger (original plan).
- (B) **Soft cleanup** — remove the call sites that are now no-ops
  (`setAgentRunId` on success, `relinkArtifactRun` on every artifact),
  collapse the cancel/approve/reject routes to use the URL `runId`
  directly. Keep the column + helpers as inert legacy code with
  `@deprecated` doc comments.

→ Going with (B). Original escalation rule still applies; we get the
readability win without touching SQLite.

## What changes

### Phase 1 — voice cancellation
- `lib/voice/use-voice-session.ts` — `interrupt()` already pops the
  conversation entries; verify the truncated assistant message
  (`assistantId` row) is removed from `conversationRef.current` so the
  next turn doesn't replay garbage. Add a small helper that trims the
  pending assistant entry on interrupt.
- `lib/voice/use-voice-session.ts` — when consuming the SSE stream,
  treat `RunError { message: "aborted" }` as a no-op (no toast, no
  console.error). Currently it looks identical to a real failure.
- `app/api/chat/runs/[runId]/cancel/route.ts` — after a successful
  agent-ts cancel response, call `endRun(runId, { status: "failed",
  error: "aborted" })` so the run row reflects user intent. Reuse
  existing `endRun` signature; do NOT add new columns.
- Tests: extend voice-session test (or add a focused test) covering
  post-interrupt conversation pruning.

### Phase 2 — relinkArtifactRun cleanup
- `app/api/chat/route.ts:295` — drop the `relinkArtifactRun()` call on
  ArtifactCreated. Artifacts are persisted with the canonical AG-UI
  `runId` upstream (`lib/tools/executor.ts` uses `ctx.runId`;
  `apps/agent-ts/src/server/loop.ts` uses `handle.runId`).
- `app/api/chat/route.ts:589` — drop `if (agentRunId) setAgentRunId(...)`.
  Replace with a one-line invariant log: warn if `startData.run_id !==
  runId`, so a future regression in agent-ts surfaces immediately.
- `app/api/chat/runs/[runId]/cancel/route.ts:25` — replace
  `getAgentRunId(runId) ?? runId` with the URL `runId` directly. Drop
  the `getAgentRunId` import.
- `app/api/chat/approve/route.ts:18-25` — drop `getAgentRunId(runId)`
  null-check; pass the URL `runId` straight to agent-ts.
- `app/api/chat/reject/route.ts:18-25` — same.
- `lib/agui/db.ts` — `@deprecated` JSDoc on `setAgentRunId`,
  `getAgentRunId`, `relinkArtifactRun`. Leave implementations.
- `app/api/chat/route.ts` — remove the now-unused `setAgentRunId` and
  `relinkArtifactRun` imports from line 38/41.
- Tests: confirm any approve/reject/cancel route tests still pass after
  the call-site simplification.

## What stays
- `lib/voice/session-machine.ts` — voice FSM is correct as-is.
- `lib/voice/speech-handle.ts` — abort controllers + interrupt are correct.
- `lib/voice/audio-output.ts` — TTS teardown path is correct.
- `apps/agent-ts/src/server/runs.ts` — cancel hook is fine
  (`handle.controller.abort()` flows into the loop's `signal.aborted`
  check at loop.ts:178 and emits RunError).
- `lib/agui/db.ts` schema — no column changes (escalation rule).
- The `agent_run_id` column — left in place as inert.

## Implementation order
1. Phase 1 — voice cancellation polish. Commit.
2. Phase 2 — relink + setAgentRunId cleanup. Commit.

## Verification
- `npx tsc --noEmit -p tsconfig.json` clean.
- `bun test lib/voice/` for voice-session changes.
- Targeted: `bun test lib/voice/use-voice-session.test.ts` if it exists,
  else extend `session-machine.test.ts`.
- Manual smoke (when feasible): start a voice turn, interrupt mid-stream,
  verify:
  - No "Error: aborted" toast.
  - Next turn does NOT replay the truncated assistant message in LLM
    context.
  - SQLite `runs` row is `failed` with error `"aborted"`.
- Confirm Phase 2 doesn't break any existing approve/reject/cancel test.

## Decision rules
- If a SQLite schema change would help: STOP, defer.
- If `pi-agent-core` swallows the abort signal mid-LLM-stream: log,
  escalate, don't patch upstream from here.
- If `getAgentRunId` ever returned a different id than the URL `runId`
  during canonical-runId integration tests: that's a regression in
  agent-ts; abort Phase 2 and investigate before stripping the fallback.

## Escalation triggers
- Any need to modify `lib/agui/db.ts` schema. STOP.
- Any need to modify `pi-agent-core` source. STOP.
- Any need to change voice FSM transitions. STOP.

## Size estimate
- Phase 1: 3 files modified, 0 new, 0 deleted. ~40–60 lines net.
- Phase 2: ~5 files modified, 0 new, 0 deleted. ~25 lines net (mostly
  removals).

## Noticed but out of scope
- Drop `agent_run_id` column entirely (needs migration).
- Replace `RunError { message: "aborted" }` with a structured
  `RunCancelled` event (event-protocol expansion).
- Voice cancel UX: should the partial assistant message be visually
  marked "interrupted" in the transcript instead of vanishing? Product
  decision.
- Wire `req.signal` from the deck `/api/chat` POST through to
  `agent-ts /runs` so disconnects auto-cancel server-side without the
  explicit `/cancel` round-trip. Adjacent improvement, not in this run.
