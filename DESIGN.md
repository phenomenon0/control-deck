# DESIGN.md -- Agent Control Surface Visual System

> Control Deck's visual identity. This document defines the design language
> for an **agent-first** control surface -- one built around work product,
> activity phases, and artifact production, not text exchange.

---

## 1. Design Philosophy

Control Deck is not a chatbot. It is the operating layer for an entire
machine and AI stack. The primary content is **work product** (artifacts,
tool execution, analysis). Conversation is secondary. The UI must reflect
that hierarchy.

**Two archetypes power two themes:**

| Theme | Archetype | Identity |
|-------|-----------|----------|
| Default (dark-only) | **Precision** | Instant, mechanical, keyboard-first. Linear/Cursor DNA. |
| Apple (light/dark) | **Physical** | Weighted, spring-based, spacious. Apple HIG DNA. |

---

## 2. Visual Identity

### 2.1 Color System (Single Source of Truth)

All colors flow from CSS custom properties in `:root`. No hardcoded hex
in components. No Tailwind color overrides. One system.

#### Default Theme (Precision -- warm amber on cool blue-black)

```
Background Scale (luminance stepping, cool blue-black):
  --bg-base:      #06060A    // Deepest -- behind shell, page bg
  --bg-primary:   #0A0A0B    // Main content area
  --bg-secondary: #111115    // Cards, input fields, thread sidebar
  --bg-tertiary:  #1A1A1E    // Hover states, elevated surfaces
  --bg-elevated:  #222226    // Popovers, dropdowns, floating panels

Border Scale (white at low opacity):
  --border-subtle:  rgba(255, 255, 255, 0.04)   // Structural separators
  --border:         rgba(255, 255, 255, 0.06)    // Default card/input borders
  --border-bright:  rgba(255, 255, 255, 0.10)    // Focus rings, active states
  --border-accent:  rgba(212, 165, 116, 0.25)    // Accent-tinted highlights

Text Scale:
  --text-primary:   #EDEDEF    // Headings, primary content
  --text-secondary: #8B8B8E    // Labels, metadata, timestamps
  --text-tertiary:  #5C5C5F    // Placeholders, hints, disabled (alias of --text-muted)
  --text-on-accent: #FFFFFF    // Text on accent-colored backgrounds

Accent (warm amber -- Control Deck identity):
  --accent:         #D4A574    // Primary actions, active states
  --accent-hover:   #C49060    // Hover state (darker, not lighter -- amber darkens)
  --accent-muted:   rgba(212, 165, 116, 0.15)  // Backgrounds, badges
  --accent-glow:    rgba(212, 165, 116, 0.06)  // Subtle ambient glow

Semantic (desaturated -- not screaming):
  --success:        #3ECF71
  --success-muted:  rgba(62, 207, 113, 0.10)
  --warning:        #E5A63E
  --warning-muted:  rgba(229, 166, 62, 0.10)
  --error:          #E5534B
  --error-muted:    rgba(229, 83, 75, 0.10)

Agent Activity (dedicated palette):
  --agent-thinking: #B8956A    // Warm amber-tan for reasoning
  --agent-working:  #D4A574    // Follows accent for active tool execution
  --agent-done:     #3ECF71    // Green for completion
  --agent-surface:  rgba(212, 165, 116, 0.04)  // Ambient bg when agent is active

AI Indicator:
  --ai-glow:        rgba(139, 92, 246, 0.3)   // Violet shimmer for "AI is working"
  --ai-accent:      #8B5CF6                     // Violet for AI-generated content markers
```

**Why warm amber?** Every AI tool uses blue or purple. Amber says "analog
warmth in a digital space." It's the color of aged instruments, control
panels, backlit gauges. It IS "Control Deck."

#### Apple Theme (Physical -- iOS system colors)

The Apple theme uses iOS system blue (#007AFF light / #0A84FF dark) as its
accent. It does NOT use amber. This is intentional -- the Physical archetype
follows Apple HIG, not the flight-deck identity.

```
Apple Light:
  --bg-base:      #EFEFEF
  --bg-primary:   #FFFFFF
  --bg-secondary: #F5F5F7
  --bg-tertiary:  #E8E8ED
  --accent:       #007AFF
  --accent-hover: #0066D6
  --radius:       1rem (16px)

Apple Dark:
  --bg-base:      #000000
  --bg-primary:   #000000
  --bg-secondary: #1C1C1E
  --bg-tertiary:  #2C2C2E
  --accent:       #0A84FF
  --accent-hover: #409CFF
  --radius:       1rem (16px)
```

### 2.2 Typography

```
Font Stack:
  --font-sans:  "Inter", -apple-system, BlinkMacSystemFont, sans-serif
  --font-mono:  "Geist Mono", "SF Mono", ui-monospace, Consolas, monospace

Scale (Precision / default):
  --text-xs:    11px / 1.45    // Timestamps, badges, metadata
  --text-sm:    12px / 1.5     // Labels, secondary info
  --text-base:  13px / 1.6     // Default body, UI elements
  --text-md:    14px / 1.6     // Chat messages, primary content
  --text-lg:    16px / 1.5     // Section headings
  --text-xl:    20px / 1.4     // Page titles (rare)

Scale (Physical / Apple):
  --text-base:  15px           // Larger body
  --text-lg:    20px           // Roomier headings

Weights:
  400 -- Body text, messages
  500 -- Labels, nav items, buttons
  600 -- Headings, emphasis, badges

Features:
  font-feature-settings: "tnum" 1  // Tabular numerals for data
  -webkit-font-smoothing: antialiased
```

### 2.3 Spacing & Layout

```
Spacing Scale (4px base):
  --sp-1:  4px     // Tight: inline gaps, badge padding
  --sp-2:  8px     // Compact: between related items
  --sp-3:  12px    // Standard: card padding, section gaps
  --sp-4:  16px    // Comfortable: between sections
  --sp-5:  24px    // Generous: major section breaks
  --sp-6:  32px    // Spacious: page-level margins
  --sp-8:  48px    // Extra: empty state centering

Radii (modern round):
  --radius-sm:   6px     // Badges, inline elements, small pills
  --radius-md:   8px     // Buttons, inputs, small cards
  --radius-lg:   10px    // Cards, panels, images (base --radius)
  --radius-xl:   14px    // Modals, floating panels, dashboard cells
  --radius-full: 9999px  // Pills, avatars

Chat Column:
  max-width: 720px   // Tight reading width
  padding: 0 var(--sp-5)
```

---

## 3. Component Patterns

### 3.1 Message Bubbles

**User messages:** Right-aligned subtle bubble. Clearly "sent by me."

```
background: rgba(var(--accent-rgb), 0.10)
border: 1px solid rgba(var(--accent-rgb), 0.14)
border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)
padding: var(--sp-3) var(--sp-4)
max-width: 85%
margin-left: auto
```

**Assistant text:** Left-aligned, no bubble, flat. Clean reading.

```
color: var(--text-primary)
font-size: var(--text-md)
line-height: 1.6
padding: var(--sp-2) 0
max-width: 90%
```

### 3.2 Agent Activity Block

**This is the key pattern.** When the agent is working (tool calls,
reasoning, multi-step execution), it renders as a distinct "activity block"
instead of inline message content.

```
Activity Block:
  background: var(--agent-surface)
  border-left: 2px solid var(--accent)
  border-radius: 0 var(--radius-md) var(--radius-md) 0
  padding: var(--sp-3) var(--sp-4)
  margin: var(--sp-3) 0

  Header:  Tool name + status badge     [12px, --text-secondary, 500]
  Body:    Args summary or progress      [13px, --text-tertiary, 400]
  Result:  Collapsed by default          [expand to see full output]
  Timing:  Duration badge, right-aligned [11px, --text-tertiary]
```

Multiple tool calls stack vertically inside a single activity block,
not as separate cards. This communicates "one unit of work."

### 3.3 Artifact Showcase

Artifacts (images, audio, code, 3D models) render as **prominent cards**
with proper framing, not thumbnail afterthoughts.

```
Artifact Card:
  background: var(--bg-secondary)
  border: 1px solid var(--border)
  border-radius: var(--radius-lg)
  overflow: hidden
  margin: var(--sp-3) 0

  Image:   Full width in card, aspect-ratio preserved, max-height 400px
  Audio:   Custom player bar with waveform visualization
  Code:    Syntax-highlighted with "Open in Canvas" + "Copy" actions
  3D:      model-viewer with controls, min-height 280px
```

### 3.4 Input Composer

The input area is a **composer** that communicates agent capabilities
and current context.

```
Composer Container:
  background: var(--bg-secondary)
  border: 1px solid var(--border)
  border-radius: var(--radius-lg)
  padding: var(--sp-3)
  margin: 0 auto
  max-width: 720px + 2 * var(--sp-5)

  Context Row (above textarea, visible when relevant):
    - Active model badge
    - Attachment count
    - Thread context hint
    [12px, --text-tertiary, gap: var(--sp-2)]

  Textarea:
    border: none, bg: transparent
    font-size: var(--text-md)
    min-height: 44px, max-height: 200px
    placeholder: "Ask anything, or describe what you want to build..."

  Action Row (below textarea):
    Left:  [Attach] [Voice]
    Right: [Send button -- accent circle, 32x32]
    [Icons at 18px, --text-tertiary, hover: --text-secondary]

  When Agent is Running:
    - Send button becomes Stop button (--error)
    - Textarea shows "Agent is working..." placeholder
    - Subtle pulse animation on border (--accent at 0.15 opacity)
```

### 3.5 Status & Progress

```
Agent Status Strip (between messages and input):
  height: 36px
  display: flex, align-items: center, justify: center, gap: var(--sp-2)
  font-size: var(--text-sm)
  color: var(--text-tertiary)

  States:
    Thinking:  [brain icon] "Reasoning..."     color: var(--agent-thinking)
    Searching: [search icon] "Searching web..." color: var(--text-secondary)
    Executing: [play icon]  "Running code..."   color: var(--agent-working)
    Tool:      [wrench icon] "Using {tool}..."  color: var(--agent-working)
    Speaking:  [audio icon] "Speaking..."        color: var(--accent)

  Animation: icon pulses at 1.5s interval, opacity 0.5 -> 1.0
```

### 3.6 Thread Sidebar (Refined)

```
Thread Item:
  padding: var(--sp-2) var(--sp-3)
  border-radius: var(--radius-md)
  font-size: var(--text-sm)
  color: var(--text-secondary)
  cursor: pointer
  transition: background var(--duration-standard) var(--ease-precision)

  Active:
    background: var(--accent-muted)
    color: var(--text-primary)

  Hover:
    background: var(--bg-tertiary)

  Title: single line, truncated with ellipsis
  Subtitle: relative time (e.g., "2h ago"), font-size: var(--text-xs)
```

---

## 4. Layout Architecture

```
+-------+--------------------------------------------------+
| Side  |  Main Content                                     |
| bar   |                                                   |
| 200px |  +----------------------------------------------+ |
|       |  | Thread Header (optional, minimal)            | |
| [nav] |  +----------------------------------------------+ |
|       |  |                                              | |
|       |  |  Message Timeline                            | |
|       |  |  (720px max, centered)                       | |
|       |  |                                              | |
|       |  |  [user msg]            [assistant text]       | |
|       |  |  [activity block]     [artifact card]        | |
|       |  |  [user msg]            [assistant text]       | |
|       |  |                                              | |
|       |  +----------------------------------------------+ |
|       |  | Status Strip                                 | |
|       |  +----------------------------------------------+ |
|       |  | Composer                                     | |
|       |  | (720px + padding, centered)                  | |
|       |  +----------------------------------------------+ |
|       |                                                   |
|       |  Canvas Panel (when open, splits right)           |
+-------+--------------------------------------------------+
```

The thread sidebar (ThreadSidebar) lives in the shell's left sidebar as a
sub-section when on the /deck/chat route. This eliminates the nested
sidebar-within-a-pane problem.

---

## 5. Design Tokens Migration

All tokens defined in `:root` in `app/globals.css`. Components use
`var(--token)` exclusively. The `@theme inline` block bridges tokens
to Tailwind utilities.

**Anti-patterns eliminated:**
- `background: "#111113"` in JSX (use `var(--bg-secondary)`)
- `color: "rgba(255,255,255,0.35)"` in JSX (use `var(--text-tertiary)`)
- `border: "1px solid rgba(255,255,255,0.06)"` (use `var(--border)`)
- `style={{}}` objects for anything that should be a class
- Hardcoded `border-radius: Npx` where a token exists

---

## 6. Iconography

All icons from `lucide-react`, 16px default (20px in Apple theme),
stroke-width 1.5 (1.8 in Apple). No emoji. No custom SVG.

Agent state icons:
- Thinking: `Brain` or `Sparkles`
- Tool execution: `Wrench` or `Play`
- Search: `Search`
- Code: `Code`
- Image gen: `Image`
- Complete: `Check`
- Error: `AlertCircle`
- Interrupted: `Square` (stop icon)
