# BEHAVIOR.md -- Agent Chat Interaction Behavior

> Motion, timing, state machines, and interaction patterns for Control Deck's
> agent chat surface. This document defines *how things move and respond*,
> not how they look (see DESIGN.md) or what's shown (see SURFACE.md).

---

## 1. Core Principle: Communicate Agency

The agent is not typing. It's *working*. Every animation and transition
must reinforce this distinction:

- **Chatbots** show typing indicators. **Agents** show activity phases.
- **Chatbots** stream text linearly. **Agents** interleave thinking, acting, and speaking.
- **Chatbots** have two states (idle, responding). **Agents** have a state machine.

---

## 2. Run State Machine

Every agent interaction follows this state machine. The UI must clearly
communicate which state is active.

```
                    +--------+
         +--------->|  IDLE  |<---------+
         |          +--------+          |
         |              |               |
         |         [user sends]         |
         |              |               |
         |              v               |
         |        +-----------+         |
         |        | SUBMITTED |         |
         |        +-----------+         |
         |              |               |
         |     [server acknowledges]    |
         |              |               |
         |              v               |
    [run ends]   +------------+         |
    [error]      |  THINKING  |----+    |
         |       +------------+    |    |
         |              |          |    |
         |      [starts streaming] |    |
         |              |     [tool call]
         |              v          |    |
         |       +------------+   |    |
         +-------|  STREAMING |   |    |
         |       +------------+   |    |
         |              |          v    |
         |      [tool needed]  +----------+
         |              +----->| EXECUTING|---+
         |                     +----------+   |
         |                          |         |
         |                   [tool returns]   |
         |                          |         |
         |                          v         |
         |                    +----------+    |
         +--------------------| RESUMING |----+
                              +----------+
                                   |
                            [continues streaming]
```

### State Definitions

| State | Duration | What user sees | Input state |
|---|---|---|---|
| **IDLE** | Indefinite | Empty or previous messages | Composer enabled, focused |
| **SUBMITTED** | 100-500ms | User message appears, composer clears | Disabled, "Sending..." |
| **THINKING** | 0-30s | Status strip: "Reasoning...", reasoning bubble expands | Disabled, shows Stop button |
| **STREAMING** | 1-60s | Text appearing word-by-word | Disabled, shows Stop button |
| **EXECUTING** | 0-120s | Activity block with tool name + progress | Disabled, shows Stop button |
| **RESUMING** | 100-300ms | Activity block completes, text resumes | Disabled |
| **ERROR** | N/A | Error message inline, input re-enables | Enabled, retry hint |

---

## 3. Transition Animations

### 3.1 Timing Tokens

```css
--t-instant:    0ms      /* State changes that must feel immediate */
--t-micro:      80ms     /* Hover, focus, small feedback */
--t-fast:       150ms    /* Button presses, toggles, small reveals */
--t-standard:   250ms    /* Panel slides, card entrances */
--t-emphasis:   400ms    /* Major state changes, hero transitions */
--t-slow:       600ms    /* Staggered list entries, large layout shifts */

--ease-out:     cubic-bezier(0.0, 0.0, 0.2, 1.0)   /* Default decelerate */
--ease-in-out:  cubic-bezier(0.4, 0.0, 0.2, 1.0)   /* Symmetric */
--ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1.0) /* Overshoot (rare) */
--ease-linear:  linear                                /* Progress bars only */
```

### 3.2 Message Entrance

**User message (sent):**
```
opacity: 0 -> 1          duration: var(--t-fast)
transform: translateY(8px) -> translateY(0)
ease: var(--ease-out)
```

**Assistant message (received):**
```
opacity: 0 -> 1          duration: var(--t-standard)
transform: translateY(12px) -> translateY(0)
ease: var(--ease-out)
delay: 80ms after state change
```

**Activity block (tool execution starts):**
```
opacity: 0 -> 1          duration: var(--t-standard)
height: 0 -> auto         (use CSS grid trick: grid-template-rows 0fr -> 1fr)
border-left color: transparent -> var(--accent)
ease: var(--ease-out)
```

### 3.3 Streaming Text

Text streams in as raw characters (current behavior). No per-word animation.
The scroll behavior is the animation:

```
Scroll to bottom:
  behavior: "smooth"
  Only when user is already at bottom (within 100px)
  If user has scrolled up: show "New content below" pill, don't auto-scroll
```

### 3.4 State Transitions

**IDLE -> SUBMITTED:**
```
1. User message slides in          (var(--t-fast), translateY)
2. Composer input clears            (instant)
3. Composer border pulses once      (var(--t-standard), accent glow)
4. Send button -> Stop button       (var(--t-fast), crossfade)
```

**SUBMITTED -> THINKING:**
```
1. Status strip fades in            (var(--t-fast))
2. "Reasoning..." label appears     (var(--t-fast))
3. Brain icon starts pulsing        (continuous, 1.5s period)
4. Reasoning bubble begins expanding (if reasoning content arrives)
```

**THINKING -> STREAMING:**
```
1. Status strip updates text         (crossfade, var(--t-fast))
2. Assistant message placeholder in  (var(--t-standard), translateY)
3. Text begins streaming             (no animation, raw append)
4. Reasoning bubble collapses        (var(--t-standard), if it was open)
```

**STREAMING -> EXECUTING:**
```
1. Text streaming pauses             (visible: content stops growing)
2. Activity block slides in below    (var(--t-standard), height expand)
3. Tool name + "running" badge       (var(--t-fast), fade in)
4. Status strip: "Using {tool}..."   (crossfade)
```

**EXECUTING -> RESUMING -> STREAMING:**
```
1. Activity block: badge -> "done"   (var(--t-fast), color change)
2. Activity block collapses to summary (var(--t-standard), height shrink)
3. Text streaming resumes below      (var(--t-fast))
```

**Any -> IDLE (run complete):**
```
1. Status strip fades out            (var(--t-fast))
2. Stop button -> Send button        (var(--t-fast), crossfade)
3. Composer re-enables               (instant)
4. Composer input focuses            (instant)
5. Last message gets a subtle "complete" indicator (checkmark, var(--t-fast))
```

---

## 4. Micro-interactions

### 4.1 Composer Focus

```
Border: var(--border) -> var(--border-bright)
Transition: var(--t-fast) var(--ease-out)
No glow. No shadow. Just border luminance shift.
```

### 4.2 Button Hover

```
Background: transparent -> var(--bg-tertiary)
Transition: var(--t-micro) var(--ease-out)
```

### 4.3 Button Press

```
transform: scale(0.97)
Transition: var(--t-micro) var(--ease-out)
Release: scale(1.0), var(--t-fast)
```

### 4.4 Send Button (Active)

```
Idle (has text):     background: var(--accent)
Hover:               background: var(--accent-hover)
Press:               transform: scale(0.93)
Disabled (no text):  background: var(--bg-tertiary), opacity: 0.5
Loading (stop mode): background: var(--error)
```

### 4.5 Tool Call Badge

```
running:   background: var(--accent-muted), color: var(--accent)
           Shimmer animation: linear-gradient sweep, 2s, infinite
complete:  background: var(--success-muted), color: var(--success)
error:     background: var(--error-muted), color: var(--error)

Transition between states: var(--t-fast) crossfade on background + color
```

### 4.6 Artifact Entrance

```
opacity: 0 -> 1
transform: scale(0.96) -> scale(1.0)
Transition: var(--t-standard) var(--ease-out)

Image load: placeholder shimmer -> image fade-in (var(--t-standard))
```

### 4.7 Scroll-to-Bottom Pill

When user scrolls up during streaming:

```
Appears: slide up from bottom edge (var(--t-fast), translateY)
"New content below" + down-arrow icon
Click: smooth scroll to bottom
Auto-dismiss: when user is at bottom
```

---

## 5. Keyboard Behavior

### 5.1 Priority System

Keyboard shortcuts use a priority queue. Higher priority wins on conflict.

```
Priority 100: Modal overlays (command palette, settings drawer)
Priority  50: Floating panels (canvas, inspector)
Priority  20: Composer (Enter to send, Escape to clear)
Priority  10: Navigation (number keys, Cmd+K)
Priority   0: Global (Cmd+., Cmd+Shift+V)
```

### 5.2 Composer Keyboard

```
Enter          -> Submit (if text present)
Shift+Enter    -> Newline
Escape         -> Clear input (if text present), then blur
Cmd+V          -> Paste (including image paste from clipboard)
Up Arrow       -> Edit last user message (if input empty, cursor at start)
Tab            -> Accept autocomplete suggestion (future)
```

### 5.3 Chat Navigation

```
Cmd+N          -> New thread
Cmd+W          -> Close/delete current thread (with confirmation)
Cmd+[          -> Previous thread
Cmd+]          -> Next thread
Space (no focus)-> Scroll page down
```

---

## 6. Voice Interaction Behavior

### 6.1 Push-to-Talk

```
Space down (no input focus):
  1. Agent stops speaking (if was speaking)  -- instant
  2. Mic activates                           -- var(--t-fast)
  3. Composer shows waveform indicator       -- var(--t-fast)
  4. Border turns accent                     -- var(--t-fast)

Space up:
  1. Mic deactivates                         -- instant
  2. STT processing begins                   -- "Processing..." label
  3. Transcript appears in composer          -- var(--t-fast) fade
  4. Auto-send after 500ms silence           -- if voice.autoSend enabled
```

### 6.2 VAD (Voice Activity Detection)

```
Mic button click:
  1. Listening starts                        -- border pulses (continuous)
  2. Audio level reflected in waveform       -- real-time, no easing
  3. Silence detected (configurable timeout)
  4. STT processing + auto-send              -- same as push-to-talk release
```

### 6.3 TTS Playback

```
Assistant response complete + readAloud enabled:
  1. Speaking indicator in status strip      -- var(--t-fast)
  2. Audio plays
  3. Speaking indicator clears               -- var(--t-fast)

User can interrupt by:
  - Clicking Stop (in status strip)
  - Starting to speak (PTT or VAD)
  - Pressing Escape
```

---

## 7. Error States

### 7.1 Network Error (Agent-GO unreachable)

```
1. Streaming stops
2. Error message appears inline (below last content):
   "Connection lost. [Retry]"
   background: var(--error-muted)
   border-left: 2px solid var(--error)
3. Composer re-enables
4. Retry button re-sends the last user message
```

### 7.2 Tool Execution Error

```
1. Activity block badge -> "error" state (red)
2. Error message shown in activity block body
3. Agent continues (may have fallback logic)
4. No user action needed unless agent asks
```

### 7.3 Interrupted Run

```
1. User clicks Stop
2. Abort signal sent to /api/chat
3. Current content preserved (partial text stays)
4. Status: "[Response stopped]" appended to message
5. Composer re-enables immediately
```

---

## 8. Reduced Motion

When `prefers-reduced-motion: reduce` is active:

```
- All transitions: duration -> 0ms (instant)
- No shimmer animations
- No pulse animations
- Scroll behavior: "auto" (not "smooth")
- Status strip: static icon, no pulse
- Entrance animations: just appear (no translate/scale)
```

Implementation: a single CSS block at the top of globals.css:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```
