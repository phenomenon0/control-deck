# SURFACE.md -- Agent Chat Information Architecture

> What to expose, what to hide, what to decompose. This document defines
> the information hierarchy and component decomposition for Control Deck's
> agent chat surface redesign.

---

## 1. The Problem Statement

Control Deck's chat surface has an identity crisis. It renders like a
messaging app but the content is agent work product. The result:

- **Tool calls** are collapsed cards that users ignore
- **Artifacts** are small thumbnails below walls of text
- **Agent reasoning** is a hidden collapsible bubble
- **Progress** is a 6px dot
- **The composer** is a textarea with no context
- **ChatPaneV2** is a 428-line monolith that owns everything

The surface doesn't match the substance. An agent producing a complex
artifact through 5 tool calls with reasoning should *feel* like watching
a craftsman work -- not like receiving a text message.

---

## 2. Information Hierarchy

What matters most, in order:

```
1. ARTIFACTS        -- The work product. Images, code, audio, 3D models.
                       This is what the user actually wanted.

2. AGENT ACTIVITY   -- What the agent is doing RIGHT NOW. Tool execution,
                       reasoning, search. This builds trust and enables control.

3. CONVERSATION     -- The text exchange. User requests, agent explanations.
                       Important but not primary.

4. METADATA         -- Model name, token count, timing, thread info.
                       Useful but should never compete for attention.
```

**Current state inverts this:** conversation text dominates, artifacts
are afterthoughts, activity is hidden, metadata is scattered.

---

## 3. What to Expose

### 3.1 First-Class: Agent Activity Timeline

The message timeline becomes a **mixed timeline** of conversation turns
and activity blocks. Activity is not subordinate to messages -- it's
interleaved at the same level.

```
Timeline structure:
  [User message]
  [Agent: reasoning bubble]          <-- thinking phase
  [Agent: activity block]            <-- tool execution
    |- search_web("latest news")     <-- tool step
    |- execute_code(python)          <-- tool step
  [Agent: text response]             <-- streaming text
  [Agent: artifact card]             <-- image/code/audio result
  [User message]
  ...
```

Each element is a **timeline segment**. The component tree reflects this:

```tsx
<ChatTimeline>
  <TimelineSegment type="user-message" />
  <TimelineSegment type="agent-reasoning" />
  <TimelineSegment type="agent-activity">
    <ActivityStep tool="search_web" status="complete" />
    <ActivityStep tool="execute_code" status="running" />
  </TimelineSegment>
  <TimelineSegment type="agent-message" />
  <TimelineSegment type="artifact" />
</ChatTimeline>
```

### 3.2 First-Class: Run Progress

When the agent is actively working, a persistent status strip sits between
the timeline and composer. It shows:

- Current phase (thinking / searching / executing / streaming)
- Active tool name (if executing)
- Elapsed time
- Stop button

This replaces the current 6px blinking dot and scattered status text.

### 3.3 Promoted: Artifact Showcase

Artifacts render as **large, interactive cards** in the timeline.
They're not thumbnails tacked onto message bottoms.

- Images: full-width card with expand/canvas/download actions
- Code: syntax-highlighted block with run/copy/canvas actions
- Audio: custom player with waveform
- 3D: model-viewer with orbit controls
- HTML: live preview iframe

### 3.4 Exposed: Composer Context

The composer shows relevant context when available:

- Active model name (small badge, top-left)
- Attachment previews (thumbnail row above textarea)
- Voice mode indicator (when listening)
- Agent capability hints (subtle, not intrusive)

---

## 4. What to Hide

### 4.1 Hidden: Raw Tool Call JSON

Users never see `{ "tool": "execute_code", "args": { "code": "..." } }`.
The activity block renders a human-readable summary:

```
Instead of:  {"tool":"search_web","args":{"query":"latest news"}}
Show:        search_web  "latest news"  [3 results, 1.2s]
```

### 4.2 Hidden: Internal IDs

No runId, threadId, messageId, toolCallId visible in the UI.
These exist in the DOM (data attributes) for debugging but never render.

### 4.3 Hidden: Strip Patterns

The current `STRIP_PATTERNS` array in MessageRenderer (15+ regex patterns)
is a symptom of the backend sending UI-unfriendly content. The fix:

- Backend should never send markdown image syntax for tool-generated artifacts
- Backend should never send "Image generated: ..." success messages
- Backend should send structured events (ArtifactCreated) instead of text

Until backend is fixed, the strip patterns stay but move to a shared util.

### 4.4 Hidden: Thread Management (from chat area)

Thread creation, deletion, renaming -- these move to the shell sidebar.
The chat pane doesn't own thread CRUD. It receives a `threadId` prop.

### 4.5 De-emphasized: Metadata

Token counts, model info, timing data -- available on hover or in
a "details" expandable, never competing with content.

---

## 5. What to Decompose

### 5.1 ChatPaneV2 -> ChatSurface (orchestrator) + 6 focused components

The monolithic ChatPaneV2.tsx (428 lines, 20+ useState) breaks into:

```
ChatSurface.tsx (new orchestrator -- ~100 lines)
  |- Props: threadId, model (from route/shell)
  |- Composes: timeline + status + composer
  |- Owns: run state machine (single useReducer)
  |- No direct DOM rendering of messages

ChatTimeline.tsx (new -- ~80 lines)
  |- Props: segments (TimelineSegment[])
  |- Pure rendering: maps segments to components
  |- Scroll management (auto-scroll, scroll-to-bottom pill)
  |- No state beyond scroll position

TimelineSegment.tsx (new -- ~60 lines)
  |- Discriminated union renderer
  |- Routes to: UserMessage, AgentMessage, ActivityBlock, ArtifactCard
  |- Handles entrance animations

AgentActivityBlock.tsx (new -- replaces inline tool card rendering, ~120 lines)
  |- Props: steps (ActivityStep[]), status
  |- Renders grouped tool executions as one unit
  |- Collapsible: summary view (default) / detail view

StatusStrip.tsx (new -- replaces scattered status indicators, ~50 lines)
  |- Props: runState, toolName, elapsed
  |- Pure presentational
  |- Shows phase icon + label + stop button

ChatComposer.tsx (evolved from ChatInput.tsx -- ~150 lines)
  |- Props: onSubmit, onStop, runState, model, uploads
  |- Owns: input value, resize, file handling
  |- Context row (model, attachments)
  |- Action row (attach, voice, send/stop)
```

### 5.2 useSendMessage + useSSE -> useAgentRun (unified hook)

The two hooks that manage the agent interaction merge into one:

```
useAgentRun.ts (new -- ~300 lines)
  |- Input: threadId, model
  |- Output:
  |    state: RunState (idle | submitted | thinking | streaming | executing | error)
  |    segments: TimelineSegment[] (the full timeline for this thread)
  |    send(text, uploads?) -> void
  |    stop() -> void
  |    retry() -> void
  |
  |- Internal:
  |    useReducer for state machine (replaces 10+ useState)
  |    SSE subscription (from useSSE, simplified)
  |    Fetch logic (from useSendMessage, simplified)
  |    Timeline building (segments accumulated as events arrive)
```

**Why merge:** The current split creates a coordination problem.
`useSendMessage` manages the fetch + text stream. `useSSE` manages
the event stream. But they're two views of the same run. State like
"is the agent working" requires checking both. A unified hook with
a proper state machine eliminates this.

### 5.3 Thread Management -> useThreadManager (separate concern)

Thread CRUD moves out of ChatPaneV2:

```
useThreadManager.ts (evolved from useThreads -- ~150 lines)
  |- Lives at shell level, not chat pane level
  |- Provides: threads[], activeThreadId, create/select/delete/rename
  |- Chat pane receives threadId as prop
  |- Thread sidebar reads from this hook via context
```

### 5.4 Right Rail Sync -> Eliminated

The current RightRailProvider with its Slot/Data pattern is over-engineered.
The chat pane shouldn't push data to the right rail. Instead:

- Right rail reads from the same `useAgentRun` context
- Or: right rail subscribes to the same SSE stream independently
- The bidirectional Slot pattern is removed

### 5.5 Voice -> useVoiceIO (isolated)

Voice functionality stays isolated but gets a cleaner interface:

```
useVoiceIO.ts (evolved from useVoiceChat)
  |- Input: config (engine, mode, thresholds)
  |- Output:
  |    startListening() / stopListening()
  |    speak(text) / stopSpeaking()
  |    transcript: string
  |    isListening / isSpeaking / isProcessing
  |
  |- ChatComposer integrates via simple callbacks
  |- No voice state leaks into run management
```

---

## 6. Backend Surface Changes

### 6.1 API Route: /api/chat (simplification)

Current problems:
- Double streaming (text in response body + events in SSE)
- Client must coordinate two streams
- `stripFakeToolPatterns` is a patch for a backend problem

**New approach:**
- Single response stream: SSE events only (no raw text body)
- Text content arrives as `TextMessageContent` events (already does this)
- Client reads one stream, builds timeline from events
- Remove the dual TransformStream + EventSource pattern

```
Current flow:
  Client                    Server
  |-- POST /api/chat ------>|
  |<-- text body stream ----|  (text only, no structure)
  |                         |
  |-- GET /api/agui/stream->|
  |<-- SSE events ----------|  (structured, but separate)

New flow:
  Client                    Server
  |-- POST /api/chat ------>|
  |<-- SSE event stream ----|  (everything in one stream)
  |                         |
  |  Events include:
  |    RunStarted
  |    TextMessageContent { delta }
  |    ToolCallStart { name }
  |    ToolCallResult { result }
  |    ArtifactCreated { url, mime }
  |    RunFinished / RunError
```

### 6.2 Thread Title Generation

Current: setTimeout polling at 2500ms. Unreliable.

**New:** Server generates title as a side effect of the first run.
Returns it in the `RunFinished` event payload. Client updates
thread title from that event, not from polling.

```
RunFinished event (extended):
{
  type: "RunFinished",
  runId: "...",
  threadTitle?: string,   // New: LLM-generated title
  inputTokens?: number,
  outputTokens?: number
}
```

### 6.3 Search Integration

Current: Client decides if search is needed, calls /api/search,
injects context into user message text. This pollutes conversation history.

**New:** Search becomes a server-side tool, not client-side preprocessing.
Agent-GO decides if search is needed (it already has web_search tool).
Results arrive as ToolCallResult events in the activity block.

Remove from client:
- `shouldSearch()` heuristic
- `/api/search` call in useSendMessage
- Search context injection into message content

---

## 7. Component File Map

New/modified files and what they replace:

```
NEW FILES:
  components/chat/ChatSurface.tsx      <- replaces ChatPaneV2.tsx
  components/chat/ChatTimeline.tsx     <- new (message list extraction)
  components/chat/TimelineSegment.tsx  <- new (segment type router)
  components/chat/AgentActivityBlock.tsx <- replaces inline tool rendering
  components/chat/StatusStrip.tsx      <- replaces scattered status indicators
  components/chat/ChatComposer.tsx     <- evolves from ChatInput.tsx
  lib/hooks/useAgentRun.ts            <- merges useSendMessage + useSSE
  lib/hooks/useThreadManager.ts       <- evolves from useThreads

MODIFIED FILES:
  components/DeckShell.tsx             <- removes RightRailProvider nesting
  components/shell/Sidebar.tsx         <- adds thread list sub-section
  app/api/chat/route.ts               <- SSE-only response stream
  app/globals.css                      <- new tokens, agent activity styles

DELETED FILES (after migration):
  components/panes/ChatPaneV2.tsx      <- replaced by ChatSurface
  components/chat/ChatInput.tsx        <- replaced by ChatComposer
  lib/hooks/useSendMessage.ts          <- merged into useAgentRun
  lib/hooks/useSSE.ts                  <- merged into useAgentRun
  lib/hooks/useRightRail.tsx           <- eliminated (direct context read)
```

---

## 8. Data Flow (Simplified)

```
User types + sends
       |
       v
ChatComposer.onSubmit(text, uploads)
       |
       v
useAgentRun.send(text, uploads)
       |
       +---> POST /api/chat { messages, model, threadId }
       |
       +---> dispatch({ type: "SUBMITTED" })
       |
       v
Server proxies to Agent-GO, returns SSE stream
       |
       v
useAgentRun processes events:
       |
       +---> RunStarted        -> dispatch({ type: "THINKING" })
       +---> TextMessageContent -> dispatch({ type: "STREAMING", delta })
       +---> ToolCallStart      -> dispatch({ type: "EXECUTING", tool })
       +---> ToolCallResult     -> dispatch({ type: "TOOL_DONE", result })
       +---> ArtifactCreated    -> dispatch({ type: "ARTIFACT", artifact })
       +---> RunFinished        -> dispatch({ type: "COMPLETE" })
       +---> RunError           -> dispatch({ type: "ERROR", error })
       |
       v
Each dispatch updates:
  1. runState (for StatusStrip + ChatComposer)
  2. segments[] (for ChatTimeline)
       |
       v
React re-renders ChatSurface tree
```

---

## 9. Migration Strategy

This is not a big-bang rewrite. Phases:

### Phase 1: Foundation (this redesign cycle)
- Create design documents (DESIGN.md, BEHAVIOR.md, SURFACE.md) [DONE]
- Add new CSS tokens to globals.css
- Create `useAgentRun` hook with state machine
- Create `ChatSurface` shell that renders existing components initially

### Phase 2: Timeline
- Create `ChatTimeline` and `TimelineSegment` components
- Create `AgentActivityBlock` replacing inline tool rendering
- Create `StatusStrip` replacing scattered indicators
- Wire into `ChatSurface`

### Phase 3: Composer
- Create `ChatComposer` evolving from `ChatInput`
- Add context row (model, attachments)
- Add stop/retry behavior tied to `useAgentRun` state

### Phase 4: Backend
- Unify /api/chat to SSE-only response
- Move search to server-side tool
- Add threadTitle to RunFinished event
- Remove stripFakeToolPatterns (fix at source)

### Phase 5: Cleanup
- Delete old files (ChatPaneV2, ChatInput, useSendMessage, useSSE)
- Remove RightRailProvider
- Remove thread management from chat pane
- Audit and remove all hardcoded colors/inline styles

---

## 10. What We're NOT Changing

Explicitly out of scope for this redesign:

- **Shell layout** (sidebar, top bar, canvas panel positioning)
- **Non-chat panes** (Models, Runs, Tools, Comfy, DoJo, Voice)
- **Plugin system** (registry, runtime, bundle)
- **Database schema** (runs, events, messages, artifacts tables)
- **Agent-GO protocol** (event types, tool bridge)
- **Voice engine backends** (piper, xtts, chatterbox)
- **ComfyUI integration**
- **Monaco editor / Canvas panel internals**
