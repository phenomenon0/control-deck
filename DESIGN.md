# DESIGN.md -- Agent Chat Surface Visual System

> Control Deck's chat surface redesign. This document defines the visual
> language for an **agent-first** conversation interface -- one that communicates
> activity, control and artifact production, not just text exchange.

---

## 1. Design Diagnosis

The current chat surface looks like a chatbot. The problems:

| What's wrong | Why it matters |
|---|---|
| Flat message column with no visual hierarchy | Can't tell "thinking" from "answering" from "doing" |
| 6px blinking dot is the only activity signal | Agent doing 30s of tool work looks identical to "typing..." |
| Tool calls render as collapsed cards *below* text | The work IS the value -- it shouldn't be an afterthought |
| Inline styles everywhere (ChatInput, UploadTray) | No design-system discipline; inconsistent feel |
| Input bar is a plain textarea | No sense of what the agent can do or what context it has |
| Artifacts are small thumbnails at message bottom | Generated images/code/audio should be showcased |
| Three conflicting color systems | CSS vars, Tailwind tokens, hardcoded hex all disagree |

**Core insight:** This is an agent control surface, not a messaging app.
The primary content is *work product* (artifacts, code, analysis),
not *conversation*. The UI must reflect that hierarchy.

---

## 2. Visual Identity

### 2.1 Color System (Single Source of Truth)

All colors flow from CSS custom properties. No hardcoded hex in components.
No Tailwind color overrides. One system.

```
Background Scale (luminance stepping, cool blue-black):
  --bg-base:      #08080A    // Deepest -- page bg behind everything
  --bg-primary:   #0C0C0F    // Main content area
  --bg-secondary: #121215    // Cards, input fields, thread sidebar
  --bg-tertiary:  #1A1A1E    // Hover states, elevated surfaces
  --bg-elevated:  #222226    // Popovers, dropdowns, floating panels

Border Scale (white at low opacity):
  --border-subtle:  rgba(255, 255, 255, 0.04)   // Structural separators
  --border:         rgba(255, 255, 255, 0.07)    // Default card/input borders
  --border-bright:  rgba(255, 255, 255, 0.12)    // Focus rings, active states
  --border-accent:  rgba(94, 106, 210, 0.25)     // Accent-tinted highlights

Text Scale:
  --text-primary:   #EDEDEF    // Headings, primary content
  --text-secondary: #8E8E93    // Labels, metadata, timestamps
  --text-tertiary:  #5C5C61    // Placeholders, hints, disabled
  --text-on-accent: #FFFFFF    // Text on accent-colored backgrounds

Accent (indigo -- agent identity):
  --accent:         #5E6AD2    // Primary actions, active states
  --accent-hover:   #6B77E0    // Hover state (lighter, not darker)
  --accent-muted:   rgba(94, 106, 210, 0.12)  // Backgrounds, badges
  --accent-glow:    rgba(94, 106, 210, 0.06)  // Subtle ambient glow

Semantic (desaturated -- not screaming):
  --success:        #3ECF71
  --success-muted:  rgba(62, 207, 113, 0.10)
  --warning:        #E5A63E
  --warning-muted:  rgba(229, 166, 62, 0.10)
  --error:          #E5534B
  --error-muted:    rgba(229, 83, 75, 0.10)

Agent Activity (new -- dedicated palette):
  --agent-thinking: #8B7EC8    // Purple-ish for reasoning
  --agent-working:  #5E6AD2    // Accent for active tool execution
  --agent-done:     #3ECF71    // Green for completion
  --agent-surface:  rgba(94, 106, 210, 0.04)  // Ambient bg when agent is active
```

### 2.2 Typography

```
Font Stack:
  --font-sans:  "Inter", -apple-system, BlinkMacSystemFont, sans-serif
  --font-mono:  "Geist Mono", "SF Mono", ui-monospace, Consolas, monospace

Scale:
  --text-xs:    11px / 1.45    // Timestamps, badges, metadata
  --text-sm:    12px / 1.5     // Labels, secondary info
  --text-base:  13px / 1.6     // Default body, UI elements
  --text-md:    14px / 1.6     // Chat messages, primary content
  --text-lg:    16px / 1.5     // Section headings
  --text-xl:    20px / 1.4     // Page titles (rare)

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

Radii:
  --radius-sm:   4px     // Badges, inline elements
  --radius-md:   6px     // Buttons, inputs, small cards
  --radius-lg:   10px    // Cards, panels, images
  --radius-xl:   16px    // Modals, floating panels
  --radius-full: 9999px  // Pills, avatars

Chat Column:
  max-width: 720px   // Narrower than current 960 -- tighter reading width
  padding: 0 var(--sp-5)
```

---

## 3. Component Patterns

### 3.1 Message Bubbles

**User messages:** Right-aligned subtle bubble. Clearly "sent by me."

```
background: rgba(94, 106, 210, 0.08)
border: 1px solid rgba(94, 106, 210, 0.12)
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

**This is the key new pattern.** When the agent is working (tool calls,
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

The input area evolves from a plain textarea into a **composer** that
communicates agent capabilities and current context.

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

Replace the 6px blinking dot with proper status communication.

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

The thread sidebar (ThreadSidebar) is **removed from ChatPaneV2** and lives
in the shell's left sidebar as a sub-section when on the /deck/chat route.
This eliminates the nested sidebar-within-a-pane problem.

---

## 5. Design Tokens Migration Plan

**Phase 1** (this redesign): Define all tokens in `:root` in globals.css.
Components use `var(--token)` exclusively. Remove all hardcoded colors
from ChatPaneV2, ChatInput, MessageRenderer, ToolCallCard.

**Phase 2** (future): Extract tokens into a separate `tokens.css` imported
by globals.css. Enable theming by swapping token files.

**Anti-patterns to eliminate:**
- `background: "#111113"` in JSX (use `var(--bg-secondary)`)
- `color: "rgba(255,255,255,0.35)"` in JSX (use `var(--text-tertiary)`)
- `border: "1px solid rgba(255,255,255,0.06)"` (use `var(--border)`)
- Tailwind utilities for colors that conflict with CSS vars
- `style={{}}` objects for anything that should be a class

---

## 6. Iconography

All icons from `lucide-react`, 16px default, 1.5 stroke width.
No emoji. No custom SVG icons unless lucide lacks the concept.

Agent state icons (new):
- Thinking: `Brain` or `Sparkles`
- Tool execution: `Wrench` or `Play`
- Search: `Search`
- Code: `Code`
- Image gen: `Image`
- Complete: `Check`
- Error: `AlertCircle`
- Interrupted: `Pause`
