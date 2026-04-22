# `lib/agui` — canonical event protocol

This module is the **source of truth** for every event that flows
between agents and the deck UI. New features that produce or consume
streaming agent activity should import from here.

## What lives here

| File | Role |
|------|------|
| `events.ts` | Discriminated union `AGUIEvent`, factory (`createEvent`), type guards, schema migration (`normalizeEvent`). |
| `payload.ts` | `DeckPayload` envelope — unifies JSON and GLYPH-compressed payloads behind a single shape. |
| `hub.ts` | Per-thread pub/sub distribution + SSE plumbing. |
| `db.ts` | SQLite persistence for threads, runs, events, messages. |
| `experimental/` | **Staging area** for AG-UI features not yet wired into the canonical surface (activity, reasoning, interrupts, tools, meta, generative-ui). Previously named `dojo/`. Only demo routes and `components/dojo/` may import from here — app/, electron/, lib/prompts/, and lib/agentgo/ must not. |

## Why AG-UI

AG-UI is the open agent-to-UI interaction spec
(<https://docs.ag-ui.com>), with 17 event types adopted across
LangGraph, CrewAI, Mastra, Google ADK, MS Agent Framework, AWS
Strands, Pydantic AI, AG2, and LlamaIndex. Standing on that spec
means:

- Any of those frameworks can emit events the deck renders natively.
- The `@ag-ui/client` npm package exists as a future escape hatch if
  the hand-rolled types fall behind the spec.
- Contributors coming from those ecosystems have zero new mental
  model to learn.

We chose to hand-roll the types rather than pull `@ag-ui/client@0.0.52`
because its dependency tree (RxJS, zod@3) clashes with the deck's
zod@4 and would nearly double `node_modules`. The trade: we keep this
file structurally aligned with the spec by hand.

## Deck-specific extensions

The spec doesn't cover everything the deck needs, so a small set of
events/fields live here that aren't part of AG-UI core:

- **`DeckPayload` envelope** wraps payload fields (`input`, `output`,
  `args`, `result`, `meta`) so downstream code can decode JSON or
  GLYPH-compressed blobs uniformly.
- **`ArtifactCreated`** — surfaces tool outputs (images, audio, 3D
  models, files) as first-class events.
- **`CostIncurred`** — per-run token/cost telemetry.

Keep these extensions minimal — if a spec event covers the use case,
use it.

## Relationship to `lib/agentgo`

`lib/agentgo` talks to the local Go agent on `localhost:4243` and
defines its own `AgentGoEvent` discriminated union. It structurally
mirrors `AGUIEvent` but uses the Go server's wire format (flat fields,
no `DeckPayload` envelope). When adding event types here, mirror them
there.

## Adding a new event type

1. Add the interface to `events.ts` and include it in the `AGUIEvent`
   union.
2. Add a type guard (`isFoo`) and re-export it from `index.ts`.
3. If the event has payload fields that may be GLYPH-compressed, wrap
   them with `DeckPayload` and extend `normalizeEvent` for v1→v2
   migration.
4. If Agent-GO emits the equivalent, mirror it in
   `lib/agentgo/client.ts`.
5. Bump `AGUI_SCHEMA_VERSION` only on breaking changes to existing
   events.
