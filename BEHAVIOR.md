# BEHAVIOR.md -- Agent Control Surface Interaction System

> How Control Deck moves and responds. This document defines the motion,
> timing, state machines, and feedback patterns for both design archetypes.
>
> **Core principle:** Agents are not typing -- they're working. Animations
> must reinforce activity phases, not simulate conversation.

---

## 1. Dual-Archetype System

Control Deck supports two archetypes, activated via `data-design` on `<html>`:

| Archetype | Theme | Motion feel | Transitions | Animation library |
|-----------|-------|-------------|-------------|-------------------|
| **Precision** | Default (dark) | Instant, mechanical, sharp | CSS transitions only | None -- pure CSS |
| **Physical** | Apple (light/dark) | Weighted, spring-based, theatrical | CSS + spring keyframes | None -- pure CSS |

Both archetypes share the same state machines and component structure.
Only timing, easing, and entrance behavior differ.

---

## 2. Run State Machine

The agent run lifecycle drives all chat surface animations:

```
IDLE  -->  SUBMITTED  -->  THINKING  -->  STREAMING  <-->  EXECUTING
                                              |                |
                                              v                v
                                          RESUMING  <------+
                                              |
                                              v
                                            IDLE

ERROR can be reached from any active state.
```

| State | Visual signal | Duration |
|-------|--------------|----------|
| IDLE | No indicator, composer shows Send | -- |
| SUBMITTED | Composer shows "Sending..." | 0-500ms |
| THINKING | Status strip: Brain icon + "Reasoning...", pulsing | 0-30s |
| STREAMING | Text appearing, streaming cursor dot | 1-60s |
| EXECUTING | Activity block, tool badges shimmer | 1-120s |
| RESUMING | Brief transition back to streaming | <500ms |
| ERROR | Error block with retry button | Until dismissed |

---

## 3. Timing & Easing Tokens

### 3.1 Precision Archetype (Default Theme)

Fast, mechanical, deceleration-only. No bounce, no overshoot.

```css
/* Duration tokens */
--t-instant:    0ms       /* Immediate state changes */
--t-micro:      80ms      /* Hover, focus, small feedback */
--t-fast:       150ms     /* Button presses, toggles, reveals */
--t-standard:   250ms     /* Panel slides, card entrances */
--t-emphasis:   400ms     /* Major state changes */
--t-slow:       600ms     /* Staggered lists, large shifts */

/* General UI transitions (variant-adaptive) */
--duration-micro:    20ms
--duration-standard: 150ms
--duration-emphasis: 150ms
--duration-exit:     150ms

/* Easing curves */
--ease-precision:  cubic-bezier(0, 0, 0.2, 1)        /* Default deceleration */
--ease-out:        cubic-bezier(0.0, 0.0, 0.2, 1.0)  /* Enters fast, settles */
--ease-in-out:     cubic-bezier(0.4, 0.0, 0.2, 1.0)  /* Symmetric */
--ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1)  /* Rare: overshoot */
--ease-linear:     linear                              /* Progress bars only */
```

### 3.2 Physical Archetype (Apple Theme)

Weighted, spring-based, theatrical. Entrances overshoot, exits decelerate.

```css
/* General UI transitions (override default) */
--duration-micro:    20ms
--duration-standard: 240ms
--duration-emphasis: 350ms
--duration-exit:     200ms

/* Easing curves */
--ease-apple:        cubic-bezier(0.4, 0, 0.6, 1)        /* Symmetric ease */
--ease-apple-soft:   cubic-bezier(0.25, 0.1, 0.25, 1)    /* Subtle, no overshoot */
--ease-apple-spring: cubic-bezier(0.34, 1.56, 0.64, 1)   /* Spring with overshoot */

/* Usage rules:
   - ease-apple:        hover states, bg shifts, color changes
   - ease-apple-soft:   subtle transitions, opacity fades
   - ease-apple-spring: entrances, scale-in, significant state changes
*/
```

---

## 4. Transition Specifications

### 4.1 Message Entrances

**User message (Precision):**
```css
transform: translateY(8px) -> translateY(0)
opacity: 0 -> 1
duration: var(--t-fast)  /* 150ms */
easing: var(--ease-out)
```

**User message (Physical):**
```css
transform: translateY(8px) scale(0.98) -> translateY(0) scale(1)
opacity: 0 -> 1
duration: var(--duration-standard)  /* 240ms */
easing: var(--ease-apple-spring)
```

**Assistant message (both):**
```css
transform: translateY(12px) -> translateY(0)
opacity: 0 -> 1
duration: var(--t-standard)  /* 250ms */
delay: 80ms
easing: var(--ease-out)
```

### 4.2 Activity Block

```css
/* Expand: CSS grid height trick */
grid-template-rows: 0fr -> 1fr
border-left-color: transparent -> var(--accent)
duration: var(--t-standard)
easing: var(--ease-out)

/* Tool badge shimmer (when running) */
animation: badge-shimmer 2s linear infinite
/* linear-gradient sweep: transparent -> rgba(accent, 0.15) -> transparent */
```

### 4.3 Composer States

```css
/* Focus: border luminance shift */
border-color: var(--border) -> var(--border-bright)
duration: var(--t-micro)  /* 80ms */
/* No glow, no shadow -- just border brightness */

/* Running state: border pulse */
animation: composer-border-pulse 2s ease-in-out infinite
/* Cycles between var(--border) and var(--border-accent) */

/* Send -> Stop crossfade */
duration: var(--t-fast)  /* 150ms */
```

### 4.4 Scroll Behavior

```css
/* Auto-scroll: only when user is within 100px of bottom */
scroll-behavior: smooth  /* Precision: instant if prefers-reduced-motion */

/* "New content below" pill */
animation: scroll-pill-up
transform: translateY(8px) -> translateY(0)
opacity: 0 -> 1
duration: var(--t-fast)
```

---

## 5. Micro-interactions

### 5.1 Button States

| State | Precision | Physical |
|-------|-----------|----------|
| Hover | bg transparent -> --bg-tertiary, 80ms | Same + subtle scale(1.01), 150ms |
| Press | scale(0.97), 80ms | scale(0.95), spring return 200ms |
| Focus | --border-bright ring, instant | Same |

### 5.2 Send Button

```css
/* Has content: accent background, white icon */
background: var(--accent)  /* amber in Precision, blue in Physical */
color: var(--text-on-accent)
border-radius: var(--radius-md)  /* 8px */
size: 32x32px

/* Empty: muted, non-interactive feel */
background: var(--bg-tertiary)
opacity: 0.5

/* Agent running: error/stop state */
background: var(--error)
icon: Square (stop)
```

### 5.3 Tool Status Badge

```css
/* Running: shimmer animation */
animation: badge-shimmer 2s linear infinite
background-size: 200% 100%

/* Complete: instant color crossfade */
transition: background var(--t-instant), color var(--t-instant)
background: var(--success-muted)
color: var(--success)

/* Error: red */
background: var(--error-muted)
color: var(--error)
```

### 5.4 Artifact Entrance

```css
transform: scale(0.96) -> scale(1)
opacity: 0 -> 1
duration: var(--t-standard)  /* 250ms */
easing: var(--ease-out)
```

---

## 6. Keyboard Shortcuts

Priority system (higher number = higher priority, wins on conflict):

| Priority | Scope | Examples |
|----------|-------|---------|
| 100 | Modals, command palette | Escape closes modal |
| 50 | Panels, inspector, canvas | Escape closes panel |
| 20 | Composer | Enter submits, Shift+Enter newline |
| 10 | Navigation | 1-6 switch panes |
| 0 | Global | Cmd+K command palette |

### Core shortcuts:

| Key | Action |
|-----|--------|
| Enter | Submit message |
| Shift+Enter | New line |
| Escape | Clear composer -> blur -> close panel (priority chain) |
| Up Arrow (empty composer) | Edit last user message |
| Cmd+N | New thread |
| Cmd+W | Close thread |
| Cmd+[ / ] | Previous / next thread |
| 1-6 | Navigate panes (Chat, Runs, Models, Dojo, Tools, Comfy) |
| Cmd+K | Command palette |
| Cmd+I | Inspector toggle |
| Cmd+Shift+C | Canvas toggle |
| Cmd+. | Sidebar toggle |
| Space (no focus) | Push-to-talk |

---

## 7. Voice Behavior

### 7.1 Modes
- **Push-to-talk (PTT):** Hold Space, release to send
- **Voice Activity Detection (VAD):** Auto-detect speech start/end
- **Toggle:** Click mic to start, click again to stop

### 7.2 Visual Feedback
- Recording: mic icon pulses amber, ring expands (Precision) / spring-bounces (Physical)
- Processing: spinner replaces mic icon
- Speaking (TTS): speaker icon with animated waves

### 7.3 Interruption
Stop button, Escape key, or new speech input all interrupt:
1. TTS playback stops immediately
2. Agent run cancels
3. Status strip shows brief "Stopped" then returns to IDLE
4. Last agent message shows "[Response stopped]" indicator

---

## 8. Reduced Motion

Both `@media (prefers-reduced-motion: reduce)` and `[data-reduce-motion="1"]`
attribute trigger reduced motion mode:

| Normal behavior | Reduced alternative |
|----------------|---------------------|
| translateY/X entrance | opacity fade only (0.01ms) |
| Spring bounce | No overshoot, instant |
| Badge shimmer | Static background |
| Composer border pulse | Static border |
| Scroll: smooth | Scroll: auto |
| Scale transforms | No scale |
| Stagger delays | Simultaneous |

**Keep:** Opacity fades, color shifts, progress indicators.

---

## 9. Error States

### 9.1 Network Error
```
Inline error block:
  background: var(--error-muted)
  border-left: 2px solid var(--error)
  border-radius: 0 var(--radius-md) var(--radius-md) 0
  Contains: error message + [Retry] button
```

### 9.2 Tool Error
Activity block badge turns red. Agent continues. Error details
available on expand.

### 9.3 Interrupted Run
"[Response stopped]" label appended inline to last agent message.
Square icon + fade-in entrance animation.

---

## 10. Loading & Perceived Performance

### Precision Archetype
- **Optimistic updates:** Apply mutation locally, sync async
- **No loading spinners for reads** (data should be cached/local)
- **Error:** Inline toast with undo action, auto-retry silently
- **Real-time:** SSE for live agent updates, no polling indicators

### Physical Archetype
- **Skeleton screens:** Shaped to match final layout
- **Progressive loading:** Hero content first, secondary lazy
- **Success:** Spring-animated badge/checkmark
- **Error:** Contextual inline message with spring entrance
