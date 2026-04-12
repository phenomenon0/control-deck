# CONTROL DECK — REBUILD PLAN & IDEAS

> This is a living document. Nothing here is locked in. It's a map of what we found, what exists out there, and where this thing could go.

---

## PART 1: WHAT CONTROL DECK IS

Control Deck is not a chat app. It's not a code editor. It's not a terminal UI.

**Control Deck is the operating layer for your entire machine and AI stack.**

It's the surface you look at to know what's running, what's generating, what agents are doing, and what your hardware is up to. It's where you launch things, manage things, and talk to things. It's both the **admin backend** (settings, models, services, system health) and the **creative frontend** (chat, voice, image gen, code execution, 3D).

Think of it as:
- **Home Assistant** but for your AI stack, not your lights
- **Grafana** but you can actually *do* things, not just watch
- **LM Studio** but for ALL your models, agents, and generation pipelines
- **VS Code's command palette** but for your entire PC
- A **flight deck** — hence the name

The surface area is huge. The key is **compartmentalization** — everything has a place, nothing is overwhelming, and the command palette gets you anywhere instantly.

---

## PART 2: WHAT WE FOUND (CODEBASE AUDIT)

12 agents analyzed 120+ files. Here's the honest state of things:

### Critical Issues
| Issue | Where | Impact |
|-------|-------|--------|
| **ChatPaneV2.tsx is 1,694 lines** | `components/panes/ChatPaneV2.tsx` | 20+ useState calls, 1,250-line sendMessage callback. Untestable, unmaintainable |
| **3 conflicting color systems** | globals.css + tailwind.config.ts + Canvas components | CSS vars say `--success: #A8C090`, badges hardcode `#4ade80`, Canvas uses `bg-zinc-900`. Theme switching breaks Canvas completely |
| **Duplicate /api/system/stats polling** | DeckShell.tsx + RightRail.tsx | Both poll every 10s independently. Double the network traffic for no reason |
| **ToolCallCard duplicated** | `chat/ToolCallCard.tsx` (589 lines) + `dojo/ui/ToolCallCard.tsx` | Same component, two copies |
| **Status badges defined 4+ times** | RunsPane, ToolCallCard, ComfyPane, globals.css | All slightly different |
| **6+ scattered keyboard listeners** | DeckShell, CanvasKeyboardHandler, DeckSettingsProvider, CommandPalette, SettingsDrawer, InspectorDrawer | Race conditions on Escape, no centralized registry |
| **InspectorDrawer.tsx is dead code** | `inspector/InspectorDrawer.tsx` (326 lines) | Imported nowhere, never mounted |
| **UploadTray.tsx is 100% inline styles** | `chat/UploadTray.tsx` | Custom SVG icons instead of Lucide, doesn't use the design system at all |
| **Zero error boundaries** | Everywhere | One crash in a widget takes down the whole pane |
| **data-reduceMotion set but never consumed** | globals.css + DeckSettingsProvider | The attribute exists on the root element but no CSS rule reads it |
| **Unused Tailwind deck.* tokens** | tailwind.config.ts | `deck.accent: #3b82f6` (blue) conflicts with CSS var `--accent: #D4A574` (amber). Confusing |
| **No test coverage** | Entire codebase | 0% |
| **Silent error swallowing** | 6+ instances of `catch { }` | Errors vanish, debugging is impossible |
| **In-memory EventHub won't scale** | lib/agui/hub.ts | Singleton, not shared across processes |
| **No DB transactions** | lib/agui/db.ts | Multiple rows updated without transaction boundaries |

### What's Actually Good
- Clean TypeScript throughout, well-typed interfaces
- File-based routing with layout wrappers works well
- Tool definition system with Zod schemas is solid
- DeckPayload/GLYPH encoding is novel and clever
- Multi-provider LLM abstraction is well-architected
- Plugin system architecture is sound
- Voice integration (STT/TTS/VAD) is functional

---

## PART 3: WHAT TO STEAL

### From Agent Orchestration UIs

| Tool | Pattern to Steal | How It Fits |
|------|-----------------|-------------|
| **LangGraph Studio** | Animated graph during execution, time-travel debugging, breakpoints | Agent Runs pane — see agents executing step-by-step, pause/rewind |
| **CrewAI** | Agent identity cards (name, role, tools, avatar) + delegation visualization | Agent management — each agent is a first-class entity with a card |
| **AutoGen Studio** | Multi-agent conversation thread — see agents talking to each other | Chat pane when agents collaborate |
| **Dify.ai** | Unified build+monitor+serve platform, cost tracking, usage analytics | The Deck (home) view — cost/token/usage dashboard |
| **n8n** | Agent cluster nodes (agent + LLM + tools as a visual cluster), table data inspection | Runs pane — structured data inspection |
| **Rivet** | Type-safe colored ports, subgraph nesting | If/when you build a visual workflow editor |

**Key insight from research**: No tool does build + run + monitor well in one place. LangGraph is best at build+run for devs, Dify is best at build+monitor for everyone, n8n is best at run+monitor for production. Control Deck can be the unified layer.

### From Model Management UIs

| Tool | Pattern to Steal | How It Fits |
|------|-----------------|-------------|
| **LM Studio** | VRAM estimation bar before loading, progressive disclosure settings, Hugging Face browser | Models pane — show "this model needs ~X GB, you have Y free" |
| **Open WebUI** | Multi-model comparison (side-by-side responses), Modelfile editor | Chat pane — A/B test models |
| **Jan.ai** | Clear model lifecycle states (downloading → idle → loading → active → error), hardware-aware recommendations | Models pane — traffic-light status indicators |
| **text-generation-webui** | Sampler order drag-and-drop, exhaustive parameter control | Advanced model settings (hidden behind progressive disclosure) |
| **vLLM + Grafana** | Prometheus metrics — KV cache usage, batch size, queue depth, tokens/sec over time | System dashboard widgets |

**Key insight from research**: The biggest gap across ALL model management tools is real-time GPU/VRAM visualization. Nobody does it well. This is a differentiation opportunity for Control Deck.

### From Creative AI Dashboards

| Tool | Pattern to Steal | How It Fits |
|------|-----------------|-------------|
| **ComfyUI** | Node-graph workflow, live execution highlighting | Comfy pane (already integrated), maybe Pipeline mode |
| **InvokeAI** | Board-based asset library with metadata, unified queue across modalities | Asset/artifact management |
| **Fooocus** | Progressive disclosure (prompt + generate default, advanced toggle) | Every generation pane — simple mode vs control mode |
| **Midjourney Web** | Masonry gallery, progressive image reveal (blurry → sharp) | Gallery/artifact views |
| **ElevenLabs** | Waveform visualization, streaming audio playback | Voice pane |
| **Leonardo.ai** | Multi-modal workspace (image + canvas + texture + motion under one roof) | The unified vision — all generation types in one app |

**Key insight from research**: A unified cross-modal queue (see all pending/active/completed jobs across image, voice, 3D, code in one place) would be a killer feature no individual tool provides.

### From Home Control & Admin UIs

| Tool | Pattern to Steal | How It Fits |
|------|-----------------|-------------|
| **Home Assistant (Sections View 2025)** | Drag-and-drop card grid, auto-generated default dashboard, conditional cards | The Deck (home) view |
| **Grafana** | Template variables, cross-widget interaction (clicking one filters another), Scenes framework | Dashboard widgets that talk to each other |
| **Portainer** | Container lifecycle management (start/stop/restart/logs/exec), right-click context menus | Docker/service management (if added) |
| **Cockpit** | Real-time terminal, systemd service toggles | System pane |
| **Uptime Kuma** | Heartbeat bars (row of colored bars showing recent status) | Service health indicators |
| **Homepage (gethomepage.dev)** | Deep widget integrations with 100+ services, YAML config, lightweight | Widget architecture inspiration |
| **Umbrel** | Visual polish and brand consistency, glassmorphism done tastefully | Overall aesthetic direction |

**Key insight from research**: The "too many things" problem is THE central UX challenge. The winners solve it with: (1) command palette, (2) progressive disclosure, (3) multiple customizable views, (4) collapsible sections, (5) smart auto-dashboard.

### From Multimodal AI Interfaces & AI OS Concepts

| Product | Pattern to Steal | How It Fits |
|---------|-----------------|-------------|
| **Microsoft Copilot** | Preview → Confirm → Apply → Undo loop for AI actions | Agent action approval flow |
| **Apple Intelligence** | "AI shimmer" indicator (aurora glow when AI is working), system-wide text tools | Subtle AI-active indicator in the shell |
| **Open Interpreter** | Code-as-action with confirmation, safe-mode vs auto-run toggle | Agent autonomy settings |
| **Limitless/Rewind** | Ambient context / total recall, always-on transcription | Long-running context awareness |
| **Pieces** | Explicit context management (drag in files/snippets/URLs), cross-tool context stitching | Chat context panel — let users curate what the AI knows about |
| **Claude Computer Use** | Inline screenshots in conversation, tool-use blocks showing what the AI sees | Agent action cards in chat |
| **Samsung Circle to Search** | Gesture-select anything on screen → AI query | Screen region capture as chat input |

**Key insight from research**: The "Action Trust Ladder" is critical:
- **Level 0 — Suggest**: AI recommends, you do it
- **Level 1 — Preview+Confirm**: AI shows what it'll do, you approve
- **Level 2 — Act+Report**: AI does it, tells you after
- **Level 3 — Act+Undo**: AI does it silently, you can undo
- **Level 4 — Autonomous**: AI just handles it

Control Deck should let users set their trust level **per action category**.

### From 2025-2026 Visual Design Trends

| Trend | What It Looks Like | Where to Use |
|-------|-------------------|-------------|
| **Bento Grid** | Variable-size cards on a grid (1 large 2x2, 2 medium 2x1, 4 small 1x1). Apple-inspired | The Deck (home) view |
| **Blue-black dark mode** | Not pure black, not warm gray. Cool blue-gray base: `#0A0A0F` to `#0F1117` | Background foundation |
| **Gradient borders** | 1px border that shifts from `rgba(255,255,255,0.06)` to `rgba(accent,0.3)`. Subtle glow | Card edges, active elements |
| **24px border radius** | Everything is rounder. `16-24px` on cards, `8-12px` on buttons | All components |
| **Area charts with gradient fills** | Fading to transparent at baseline, glowing data points | Dashboard charts |
| **Negative letter-spacing on headings** | `-0.02em` tracking on headers looks modern and tight | Typography system |
| **Skeleton loading states** | Shimmer/pulse on placeholder blocks. Now expected, not optional | Every data-fetching component |
| **Side panels instead of modals** | Detail views slide in from the right (400-560px wide), can stack | Settings, inspector, detail views |
| **Command palette as primary nav** | Cmd+K searches everything — pages, actions, settings, data | Already have one, needs to be smarter |
| **Spring physics animations** | Stiffness/damping curves instead of cubic-bezier. Things feel physical | Framer Motion throughout |

---

## PART 4: DESIGN SYSTEM IDEAS

### Color Tokens (Proposed)

```css
/* ═══ BACKGROUNDS ═══ cool-tinted dark, NOT warm brown */
--bg-base:       #0C0C10;      /* deepest layer */
--bg-surface-1:  #141418;      /* cards, panels */
--bg-surface-2:  #1C1C22;      /* elevated cards, popovers */
--bg-surface-3:  #26262E;      /* hover states, active items */

/* ═══ BORDERS ═══ white at low opacity, NOT hardcoded colors */
--border-subtle:  rgba(255, 255, 255, 0.06);
--border-default: rgba(255, 255, 255, 0.10);
--border-strong:  rgba(255, 255, 255, 0.16);

/* ═══ TEXT ═══ */
--text-primary:   #EDEDEF;     /* main content */
--text-secondary: #8E8E96;     /* labels, descriptions */
--text-tertiary:  #55555E;     /* timestamps, metadata */

/* ═══ ACCENT ═══ warm amber — the Control Deck identity */
--accent:         #D4A574;
--accent-hover:   #E0B88A;
--accent-muted:   rgba(212, 165, 116, 0.15);

/* ═══ SEMANTIC ═══ desaturated, not screaming */
--success:        #4ADE80;
--warning:        #FBBF24;
--error:          #F87171;
--info:           #60A5FA;

/* ═══ AI INDICATOR ═══ */
--ai-glow:        rgba(139, 92, 246, 0.3);   /* violet shimmer for "AI is working" */
--ai-accent:      #8B5CF6;                     /* purple for AI-generated content markers */
```

### Why Warm Amber Accent?
The current codebase already uses `#D4A574` as the accent. It's distinctive — almost every AI tool uses blue or purple. Amber says "analog warmth in a digital space." It's the color of aged instruments, control panels, backlit gauges. It IS "Control Deck."

### Typography Ideas
- **Primary font**: Inter or Geist (both great for data-heavy UIs, tabular numerals)
- **Mono font**: JetBrains Mono (for code, logs, terminal output)
- **Base size**: 14px (the 2025 standard, up from 13px)
- **Headings**: Semi-bold, `-0.02em` letter-spacing (tight tracking)
- **KPI numbers**: 32-48px, tabular numeral feature enabled
- **Micro text**: 11-12px, `--text-tertiary` color

### Border Radius Scale
```
--radius-sm: 8px;     /* buttons, inputs, badges */
--radius-md: 12px;    /* smaller cards, popovers */
--radius-lg: 16px;    /* main cards, panels */
--radius-xl: 24px;    /* hero cards, bento grid items */
```

### Shadow System
```
/* No shadows on cards — use background layers for depth */
/* Shadows only on floating elements */
--shadow-popover: 0 4px 24px rgba(0, 0, 0, 0.4);
--shadow-modal:   0 8px 48px rgba(0, 0, 0, 0.6);
```

### Motion System
```
--duration-fast:   100ms;    /* hover states, toggles */
--duration-normal: 200ms;    /* panel slides, content transitions */
--duration-slow:   300ms;    /* page transitions, sheet animations */
--easing-out:      cubic-bezier(0.16, 1, 0.3, 1);    /* elements appearing */
--easing-in:       cubic-bezier(0.7, 0, 0.84, 0);    /* elements leaving */
--easing-spring:   cubic-bezier(0.34, 1.56, 0.64, 1); /* bouncy interactions */
```

---

## PART 5: ARCHITECTURE IDEAS

### Three-Mode Architecture

**Mode 1: DECK** (Home / Overview)
The landing page. A bento grid dashboard you can customize. Shows the state of everything at a glance:
- System health (CPU, GPU, VRAM, RAM, disk)
- Active agents and their status
- Recent generations (images, audio, 3D)
- Running models and their resource usage
- Service health (Agent-GO, ComfyUI, SearXNG, VectorDB, Ollama)
- Quick action cards (new chat, generate image, start agent)
- Cost/token usage over time

Idea: Auto-generate a default dashboard from discovered services. Let users rearrange, add, remove widgets.

**Mode 2: PANES** (Deep Work)
Full-screen focused views for specific activities:
- **Chat** — conversation with AI, tool calls, artifacts
- **Runs** — agent execution history, GLYPH payloads, cost tracking
- **Models** — loaded models, VRAM allocation, download manager, settings
- **Gen** — image/audio/3D generation with unified queue
- **Voice** — voice mode, transcription, TTS
- **Canvas** — code editor, execution, preview
- **Dojo** — AG-UI protocol playground
- **Tools** — tool registry, testing, bridge configuration

Each pane fills the main area. The sidebar navigates between them.

**Mode 3: COMMAND** (Power Layer)
`Cmd+K` command palette that searches EVERYTHING:
- Navigate to any pane
- Run any action (new chat, clear history, switch model, toggle settings)
- Search conversations, artifacts, runs
- Execute agent commands ("run image generation with...")
- System commands (restart service, clear VRAM, check health)
- Context-aware (in Chat pane, shows chat-specific commands first)

Idea: The command palette could accept natural language. "Show me all runs from today that cost more than $0.50" → filters the Runs pane.

### Widget System (for Deck View)

Pre-built widgets:
- `SystemHealthWidget` — CPU/GPU/RAM/disk gauges
- `VRAMWidget` — stacked bar showing per-model VRAM allocation
- `ServiceStatusWidget` — heartbeat bars (Uptime Kuma style)
- `ActiveAgentsWidget` — agent cards with status, current task, progress
- `RecentGenWidget` — thumbnail grid of recent generations (multi-modal)
- `TokenUsageWidget` — area chart with gradient fill
- `QuickActionsWidget` — grid of action buttons
- `ModelFleetWidget` — all loaded models with traffic-light status

Widget sizing: 1x1, 2x1, 2x2, 3x1, full-width. CSS Grid with gap.

### Agentic UX Patterns (from Smashing Magazine research)

These patterns should be woven throughout:

1. **Intent Preview** — before an agent acts, show a preview card of what it plans to do
2. **Autonomy Dial** — per-agent or per-action-category trust level setting (suggest / preview+confirm / act+report / act+undo / autonomous)
3. **Explainable Rationale** — agents show WHY they chose an action, not just what
4. **Confidence Signal** — visual indicator of how certain the agent is (opacity, progress ring, textual qualifier)
5. **Action Audit & Undo** — every agent action logged, reversible where possible
6. **Escalation Pathway** — when an agent is stuck or uncertain, it knows how to ask the human

### Shell Architecture (Revised)

```
<DeckShell>
  ├── <Sidebar>                 — collapsible icon sidebar (56px / 240px)
  │   ├── Deck (home)
  │   ├── Chat
  │   ├── Runs
  │   ├── Models
  │   ├── Gen
  │   ├── Voice
  │   ├── Canvas
  │   ├── Dojo
  │   └── Settings (bottom-pinned)
  │
  ├── <TopBar>                  — minimal: breadcrumb + status indicators + Cmd+K trigger
  │   ├── AI status indicator (idle / working / waiting)
  │   ├── GPU/VRAM mini gauge
  │   └── Service health dots
  │
  ├── <MainContent>             — fills remaining space
  │   └── {currentPane}         — route-based content
  │
  ├── <CommandPalette>          — modal overlay, Cmd+K
  └── <NotificationCenter>      — slide-in panel
```

### Data Architecture Ideas

- **Shared hooks** instead of duplicate polling:
  - `useSystemStats()` — single source of truth for CPU/GPU/RAM
  - `useModels()` — all available models from all providers
  - `useAgentStatus()` — active agents and their state
  - `useQueue()` — unified generation queue
- **Error boundaries** wrapping every pane and major section
- **Centralized keyboard registry** — one hook that manages all shortcuts with priority levels
- **Optimistic updates** for UI responsiveness (show change immediately, reconcile with server)

---

## PART 6: PHASE IDEAS (LOOSE, NOT RIGID)

### Phase 0: Foundation
Clean up the mess before building new things.
- Consolidate 3 color systems into 1 token set
- Delete dead code (InspectorDrawer, unused deck.* tokens, deprecated `inspectorOpen` state)
- Replace Canvas hardcoded zinc colors with CSS variables
- Wire up `data-reduceMotion` to actual CSS rules
- Create shared hooks (`useSystemStats`, `useModels`) to eliminate duplicate polling
- Centralize keyboard listener registry

### Phase 1: Component Decomposition
Break apart the god components.
- ChatPaneV2 (1,694 lines) → ChatInput, MessageList, ThreadSidebar, ToolCallBlock, useChatState, useSendMessage
- Unify ToolCallCard (merge the two copies)
- Convert UploadTray from inline styles to Tailwind/design system
- Replace custom SVG icons with Lucide
- Add error boundaries around every pane

### Phase 2: Shell & Navigation
Make the frame feel right.
- Redesign DeckShell: collapsible icon sidebar instead of top nav
- Redesign TopBar: minimal, just breadcrumb + status + Cmd+K
- Upgrade CommandPalette: context-aware commands, fuzzy search, recently used
- Add persistent status bar (GPU, VRAM, services, AI status indicator)
- Centralize all keyboard shortcuts with discoverability (show in command palette)

### Phase 3: The Deck (Home View)
The thing that doesn't exist yet — the control layer landing page.
- Build widget system (draggable bento grid)
- Auto-discover services and generate default dashboard
- Build core widgets: SystemHealth, VRAM, ServiceStatus, ActiveAgents, RecentGen, TokenUsage
- Customization: add/remove/resize/rearrange widgets

### Phase 4: Pane Improvements
Make each pane great individually.
- **Models pane**: VRAM estimation bar, lifecycle states, progressive disclosure settings, fleet management view
- **Runs pane**: Timeline visualization, cost attribution, agent identity cards, structured data inspection
- **Gen pane**: Unified queue across modalities, progress visualization per type, gallery with boards/tags
- **Voice pane**: Waveform visualization, streaming playback
- **Canvas pane**: Theme-aware Monaco, proper CSS variable integration
- **Chat pane**: (benefits from Phase 1 decomposition) — artifact pane, context management panel

### Phase 5: Trust & Data Layer
Make it reliable and trustworthy.
- Action audit log (every agent action recorded)
- Autonomy settings per action category
- SQLite transaction boundaries
- Notification center with severity levels
- Error recovery patterns (retry from failure point)

### Phase 6: Polish
Make it feel premium.
- Skeleton loading states everywhere
- Spring physics animations (Framer Motion)
- View transitions between panes
- Reduced motion support (finally consume that attribute)
- Keyboard navigation throughout
- Haptic-like micro-interactions (scale bounce on press, border glow on hover)
- Ambient AI status indicator (subtle edge glow when AI is active)

---

## PART 7: WHAT NOT TO DO

- **Don't chase "terminal UI" aesthetic.** Control Deck is a control layer, not a dev tool.
- **Don't cut features without purpose.** The surface area is huge and that's the point. Compartmentalize, don't minimize.
- **Don't make it feel like a chat wrapper.** Chat is ONE pane. The Deck (overview) should be the landing page.
- **Don't over-abstract early.** Fix the concrete problems first (color conflicts, dead code, god components), then build new.
- **Don't ignore mobile.** Not a priority, but at minimum don't break it. Responsive basics.
- **Don't fight the stack.** Next.js 16 + React 19 + Tailwind v4 + shadcn is solid. No need to rewrite foundations.
- **Don't use blue or purple as the accent.** Every AI tool does that. Amber is the identity. Keep it.

---

## PART 8: OPEN QUESTIONS

Things to figure out before or during implementation:

1. **Sidebar vs. top nav?** The plan says sidebar, but the current app uses top nav. Sidebar scales better with 8+ panes, but top nav is simpler. Or: hybrid (collapsed icon sidebar + top breadcrumb)?

2. **How smart should the command palette be?** Basic fuzzy search (current) → structured commands → natural language? How far do we go?

3. **Widget system complexity?** Drag-and-drop is expensive to build. Start with a fixed bento layout and add customization later? Or go full drag-and-drop from day one?

4. **Multi-model management scope?** Just show what's loaded and let you switch? Or full fleet management (download, quantize, compare, benchmark)?

5. **Agent autonomy UI?** A simple toggle per agent? Or a granular permission matrix (agent X can do file ops but not network, agent Y is fully autonomous)?

6. **Real-time vs. polling?** The codebase polls `/api/system/stats` every 10s. Should we move to WebSocket/SSE for real-time system metrics?

7. **Where does the "Gen" pane boundary live?** ComfyUI is already its own pane. Voice is its own pane. Do we unify all generation into one pane with tabs, or keep them separate?

8. **Theme system?** Keep the multi-theme system (forest floor, paper lab, terminal, glass, brutal, cinema) or simplify to dark + light?

---

*Last updated: 2026-02-18*
*Source: 6 codebase analysis agents + 6 research agents + live web research*
*Analyzed: 120+ files, 40+ products, 15,000+ lines of code*
