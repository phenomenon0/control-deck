# 2026-05-15 — GPU Resource Arbiter

> Goal: control deck must run video / 3D / text / audio without OOM, decompose
> tasks across model lanes, and automatically restore the chat engine when
> heavy work finishes. Make llama-swap elite where it can be; build a thin
> arbiter on top for the rest.

## TL;DR

**Keep llama-swap** for the LLM lane — it already does swap-with-TTL,
OpenAI-compat proxy, and one-model-at-a-time via `matrix` groups. It is
elite-already at *that* job.

**Build a `ResourceArbiter`** above llama-swap that owns *every* VRAM-spending
process — voice-core engines, ComfyUI, SDXL Turbo, Hunyuan 3D, Stable Audio,
Ollama vision, llama-swap itself. Llama-swap doesn't know those sidecars
exist, so without an arbiter they can collide.

Three contracts the arbiter enforces:

1. **Reservations gate every load.** No process loads weights without
   `arbiter.acquire(lane, vramMb, ttl)`. Acquire blocks (or returns `denied`)
   if the reservation would push past free VRAM minus reserve.
2. **Lanes have priority and an unload protocol.** `chat` is sticky; heavy
   lanes (`video`, `3d`) declare `evict_others=true`. Arbiter ranks lanes,
   sends `release()` to evictable holders, waits for VRAM drop, then admits.
3. **Restore plan.** Every evicted lane carries a `restoreOnIdle: true` hint.
   When arbiter sees free VRAM > restore-threshold AND no active heavy work,
   it walks the restore queue.

## Current state (what already exists)

- `lib/llamacpp/launcher.ts` — spawn+probe llama-server (one model).
- `~/.config/llama-swap/config.yaml` — already runs as systemd user unit on
  `:8080`. 9B / 35B / 3.6 with `matrix.evict_costs` and one-at-a-time policy.
- `lib/hardware/vram.ts:canFit()` — VRAM preflight estimate. **Advisory only,
  not enforced.**
- `lib/hardware/gpu-processes.ts` — per-process VRAM via `nvidia-smi
  --query-compute-apps`. Identifies `ollama|vllm|llamacpp|comfy|whisper|piper|
  pytorch`. This is the ground-truth feed for the arbiter.
- `lib/hardware/providers/*.ts` — each adapter declares `capabilities.load /
  unload` and a reason. Llama-swap is `load:false, unload:false` today.
- `lib/inference/registry.ts` + `runtime.ts` — modality → slot → provider
  bindings, mutable at runtime.
- `apps/voice-core/.../engines/base.py` — engines have `load()` / `loaded()`
  / `close()` (in StreamingSttSession). Voice-core is the only sidecar today
  with an explicit unload protocol.
- ComfyUI / SDXL / Hunyuan / Stable Audio / Ollama — **no unload protocol
  exposed to the deck.** This is the biggest gap.

## Why not "just llama-swap"

Llama-swap is excellent at its scope. It is blind to:

- **Non-llama processes.** Loads a 35B while ComfyUI is holding 14 GB →
  immediate OOM. No way to tell llama-swap to ask ComfyUI to vacate.
- **Cross-modality decomposition.** "Generate a video then resume chat"
  needs a planner that knows the order, not a TTL.
- **Smaller-while-busy downgrade.** No notion of "swap chat to 9B because
  video lane just claimed 16 GB".
- **Deck UI events.** No SSE stream of "evicting 35B", "loading SDXL",
  "restoring chat". The deck needs these for the user-facing pane.
- **Per-process kill / restart on hang.** Llama-swap can swap llama models;
  it can't `pkill -9` a stuck ComfyUI worker.

So: keep llama-swap, talk to it over HTTP from the arbiter, and let the
arbiter own the rest.

## Architecture

```
                     ┌──────────────────────────────────────┐
                     │   ResourceArbiter (in-deck, server)  │
                     │   - lane state machine                │
                     │   - VRAM ledger (live from nvidia-smi)│
                     │   - SSE event stream → deck UI        │
                     │   - decomp planner (chat→video→chat)  │
                     └──┬───────────────┬───────────────┬────┘
                        │               │               │
                  HTTP ↓               IPC ↓        spawn ↓
              ┌─────────────┐    ┌──────────────┐  ┌─────────────┐
              │ llama-swap  │    │  voice-core  │  │  ComfyUI    │
              │  :8080      │    │   :4245      │  │  + SDXL,    │
              │ LLM lane    │    │  STT/TTS     │  │  Hunyuan,   │
              └─────────────┘    └──────────────┘  │  StableAud. │
                                                    └─────────────┘
```

### Lanes (named GPU consumers)

| Lane id   | Owner                  | Sticky? | Default size | Notes                                     |
|-----------|------------------------|---------|--------------|-------------------------------------------|
| `chat`    | llama-swap (LLM)       | yes     | ~16-22 GB    | Restore-on-idle target. 35B/9B downgrade. |
| `vision`  | llama-swap / Ollama    | no      | ~10 GB       | Often shares chat lane if same backend.   |
| `tts`     | voice-core (Kokoro)    | yes-soft| ~1 GB        | Tiny, almost always co-resident.          |
| `stt`     | voice-core (Whisper)   | yes-soft| ~2 GB        | Streaming session-scoped.                 |
| `image`   | ComfyUI / SDXL Turbo   | no      | ~8 GB        | Burst lane; releases after job.           |
| `audio`   | Stable Audio           | no      | ~6 GB        | Burst lane.                               |
| `3d`     | Hunyuan 3D             | no      | ~12 GB       | Heavy; usually evicts chat.               |
| `video`   | (future Wan/SVD/etc.)  | no      | ~16-22 GB    | Heaviest; always evicts chat.             |
| `omni`    | qwen-omni-sidecar      | mode    | ~18 GB       | Mutually exclusive with chat+stt+tts.     |

### Reservation contract

```ts
// lib/resource/arbiter.ts (new)
interface AcquireRequest {
  lane: LaneId;
  estimateMb: number;              // from estimateVramMb()
  priority: "background"|"normal"|"interactive";
  ttlMs?: number;                  // auto-release on idle
  evicts?: "soft"|"hard"|"none";   // permission to evict others
  restoreOnIdle?: boolean;         // arbiter re-acquires when room opens
  reason: string;                  // shown in deck UI
}
interface AcquireResult {
  status: "granted"|"queued"|"denied";
  ticket?: string;                 // pass to release()
  waitForLane?: LaneId;            // when queued
  freeAfterMb: number;
}
```

Every load path becomes: `acquire → load → use → release`.

### VRAM ledger

Single source of truth = `nvidia-smi --query-compute-apps` polled every 2 s
+ event-driven on acquire/release. On Apple Silicon, fall back to the
`parsePsOutput` proxy already in `gpu-processes.ts`. Ledger reports:

```
freeMb, reserveMb, processes: [{pid, lane, vramMb, sinceMs}], pendingReservations
```

The fit math reuses `estimateVramMb(sizeBytes) = sizeMb * 1.3 + 512` from
`vram.ts`. **Refine it per backend** — KV-cache for llama.cpp scales with
`-c` and `--cache-type-k`, so the llamacpp adapter passes a richer estimator.

### Eviction protocol

Per-provider `unload(reason)` is mandatory. Today only voice-core has it.
We add HTTP endpoints to every sidecar:

| Sidecar         | Endpoint                         | Behaviour                                  |
|-----------------|----------------------------------|--------------------------------------------|
| llama-swap      | `POST /unload?model=<id>`        | Already exists (`/unload` since llama-swap 0.4). Verify in current build; if missing, use admin API. |
| voice-core      | `POST /engines/<id>/unload`      | New — calls `engine.close()` and drops weights. |
| ComfyUI         | `POST /free?unload_models=true`  | **Already exists** as `/free` — wire it.   |
| Stable Audio    | (new) `POST /unload`             | Add to the sidecar; pytorch `del + cuda.empty_cache`. |
| Hunyuan 3D      | (new) `POST /unload`             | Same shape.                                |
| Ollama          | `POST /api/generate` with `keep_alive:0` | Already works; we just stop calling and it drops after 5 min. Force-drop with `keep_alive:0`. |
| Qwen-Omni       | `DELETE /session`                | Existing — keep.                           |

After `unload`, arbiter **verifies the VRAM drop in the ledger** before
admitting the next acquire — never trust the sidecar's 200 OK alone.

### Decomposition planner

For multi-step user requests ("generate an image, then describe it, then
make a 3D model of it"), the planner expands into a lane DAG:

```
T1 chat (small, 9B)        ─┐
T2 image (SDXL, evict chat) ├─ chain
T3 vision (analyze)         ├─
T4 3d (Hunyuan, evict)      ├─
T5 chat restore (9B or 35B) ─┘
```

Implemented as a thin queue on top of acquire/release, not a new framework.
The planner only knows the lane graph; it never picks tools.

### "Smaller-while-busy" rule

When a heavy lane acquires AND chat is currently 35B, arbiter sends
llama-swap a swap-to-`qwen3.5-9b` request, holds the 9B until the heavy lane
releases, then restores 35B if it was the prior binding. Switch is silent
to the user except for an SSE event in the deck.

### OOM protection (the hard rule)

Three guards:

1. **Pre-acquire**: `estimateMb > freeMb - reserve` → `denied` or queue.
2. **Post-acquire trip-wire**: after the new load, ledger re-reads
   `nvidia-smi`. If free < `panicReserveMb` (default 256), immediately call
   `unload` on the most-recent non-sticky lane and re-check.
3. **PyTorch OOM trap**: every sidecar wraps its inference in
   `try / cuda.OutOfMemoryError → POST /arbiter/oom { lane }`. Arbiter
   force-releases the lane, reports `cuda_oom` to the caller, and refuses
   to re-admit that exact estimate without a 1.3× headroom bump.

The user **never** sees a raw CUDA OOM — they see "Not enough VRAM, paused
chat to free 14 GB" with a continue button.

## Phasing

### Phase 0 — visibility (1-2 days)
- New endpoint `GET /api/resource/ledger` returns current ledger snapshot
  (free/used/processes/reservations).
- New SSE stream `GET /api/resource/events`.
- New pane `components/panes/ResourcePane.tsx` showing live lanes,
  reservations, evictions. Reuses existing `gpu-processes.ts`.
- No behaviour change — pure observability.

### Phase 1 — arbiter MVP (3-5 days)
- `lib/resource/arbiter.ts` — in-memory single-process arbiter (deck server
  is already single-process).
- Wire `acquire/release` into the four already-controlled lanes:
  llama-swap (HTTP), voice-core (HTTP), ComfyUI (`/free`), Ollama
  (`keep_alive:0`).
- Pre-acquire denial works → real OOM protection for the controlled lanes.
- Restore-on-idle for `chat` only.

### Phase 2 — sidecar unload coverage (parallelisable)
- Stable Audio, Hunyuan, SDXL Turbo, qwen-omni — add `/unload` endpoint to
  each. Each is 20-40 LOC of pytorch teardown.
- Wire each into the arbiter as `evicts:"none", restoreOnIdle:false`.

### Phase 3 — decomposition planner (2-3 days)
- `lib/resource/planner.ts` — turns a user intent ("make a 3D model of a
  cat") into a lane DAG and runs it via the arbiter.
- Hook into the chat tool-call router so multi-modality requests use the
  planner instead of unilateral tool calls.

### Phase 4 — elite-mode llama-swap PR (upstream)
Three contributions worth filing back to mostlygeek/llama-swap:
1. **External-process awareness**: optional `external_vram_query` config
   hook that calls a user-defined endpoint before admitting a swap, so the
   arbiter can deny llama-swap loads when external sidecars are heavy.
2. **SSE event stream** for `swap_start / unload_done / load_done`. Today
   the deck has to poll `/v1/models`. The vision/STT/TTS panes need this.
3. **Per-lane TTL override** on the `/v1/chat/completions` call — header
   `X-Keep-Alive: 0` so we can mark single-shot requests not-worth-caching.

If upstream rejects (1), keep it local as a fork; (2)/(3) are likely
acceptable.

## What we do NOT build

- A retry framework. Single try, surface OOM, let the caller decide.
- A queueing manager other than the lane FIFO inside the arbiter.
- A daemon supervisor — systemd already owns llama-swap and voice-core.
- Cross-machine GPU scheduling. Single-host only.
- A new model registry. Reuse `lib/inference/registry.ts`.

## Open questions

- **Apple Silicon proxy.** `gpu-processes.parsePsOutput` is RSS not real
  VRAM. On unified memory it's a good-enough proxy, but the panic-reserve
  threshold must be Mac-tuned (free RAM, not free VRAM).
- **ComfyUI sub-graph isolation.** When a workflow uses 3 models in one
  run, ComfyUI's `/free` evicts all of them. Acceptable for v1; revisit if
  we expose long-running ComfyUI sessions.
- **vLLM lane.** Not in the deck today. If we add it, vLLM's `--gpu-memory-
  utilization` is fixed-at-startup — it gets a single lane reservation for
  its lifetime, not per-request.

## Success criteria

1. With chat (35B) running, calling `generate_image` followed by `image_to_3d`
   followed by `generate_audio` never OOMs and chat is restored to 35B at
   the end.
2. With ComfyUI mid-render, asking the chat lane to load 35B is **denied
   with reason**, not OOM-killed.
3. Resource pane shows live VRAM ledger, every load and evict event, and
   pending reservations.
4. `kill -9` on llama-swap mid-acquire leaves the arbiter in a consistent
   state (timeout + re-poll, not a stuck reservation).
5. `nvidia-smi` shows reserve-MB free across a full one-hour mixed-modality
   session.
