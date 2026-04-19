# Control Deck × Warp — Engineering Handoff

Everything you need to port the mock (`Control Deck — Warp direction.html`)
into your production codebase. Three layers; ship them in order.

```
handoff/
├── tokens.standalone.css     ← Layer 1: design contract (ship first)
├── tailwind.config.js        ← Layer 1 equivalent for Tailwind users
├── tweaks.tsx                ← Layer 2: runtime tweak system (React context + panel)
├── RunsPane.tsx              ← Layer 3: one pane, production-ready
├── RunsPane.module.css       ← colocated styles for RunsPane
└── README.md                 ← this file
```

---

## Layer 1 — Tokens (ship this first, alone)

**Goal:** every existing screen in your app reads from the new palette/type
scale without any component changes.

### 1a. Plain CSS path

1. Copy `tokens.standalone.css` into your app — e.g. `src/styles/tokens.css`.
2. Import it **once** at the app root, before any other CSS:
   ```ts
   // app/layout.tsx (Next) or main.tsx (Vite)
   import "./styles/tokens.css";
   ```
3. Add the tweak attributes to `<html>`:
   ```html
   <html data-warmth="neutral" data-type="matter" data-accent="amber" data-theme="dark">
   ```
4. In any component, reference tokens via `var(--token-name)`:
   ```tsx
   <div style={{ background: "var(--bg-card)", color: "var(--fg-muted)" }} />
   ```

### 1b. Tailwind path

1. Replace your `tailwind.config.js` with `handoff/tailwind.config.js`
   (or merge its `theme.extend` into yours).
2. Still import `tokens.standalone.css` once at root — Tailwind utilities
   resolve to the same `var(--*)` references, so the CSS file is the
   source of truth for values.
3. Use utilities:
   ```tsx
   <div className="bg-bg-card text-fg-muted border border-border rounded-lg p-4" />
   ```

### Token map (mental model)

| Raw (palette) | Semantic (use this)        | Role                       |
|---------------|----------------------------|----------------------------|
| `--void`      | `--bg`                     | page background            |
| `--charcoal`  | `--bg-card`                | card / surface             |
| —             | `--bg-elev`                | elevated surface (modals)  |
| `--parchment` | `--fg`                     | primary text               |
| `--ash`       | `--fg-muted`               | body copy                  |
| `--stone`     | `--fg-dim`                 | secondary / labels         |
| `--mute`      | `--fg-faint`               | disabled / ghost           |
| `--amber`     | `--accent`                 | single hero color          |
| `--mist`      | `--border`                 | hairline borders           |

**Rule:** components should reference semantic tokens, never raw palette.
That way a theme change (`data-theme="light"`) flips aliases without
touching component code.

### What ships after Layer 1

Your whole app gets the warm-editorial cast immediately. Existing
components don't need to change — they just inherit the new bg/fg/border
values. This is the cheapest possible win and should be a one-PR merge.

---

## Layer 2 — Tweaks system (runtime theming)

**Goal:** the same Warmth / Typography / Accent / Theme controls from the
mock, as a reusable React context. Any component can read or write tweaks;
the DOM stays in sync automatically.

### Install

1. Copy `tweaks.tsx` to `src/theme/tweaks.tsx`.
2. Wrap your app:
   ```tsx
   import { TweaksProvider, TweaksPanel } from "./theme/tweaks";

   export default function App() {
     return (
       <TweaksProvider>
         <Routes />
         {process.env.NODE_ENV !== "production" && <TweaksPanel />}
       </TweaksProvider>
     );
   }
   ```
3. That's it. The provider writes `data-warmth`, `data-type`, `data-accent`,
   `data-theme` to `<html>` and persists to `localStorage`.

### Reading tweaks in components

```tsx
import { useTweaks } from "./theme/tweaks";

function BrandMark() {
  const { tweaks } = useTweaks();
  return <span className={tweaks.type === "editorial" ? "serif" : "sans"}>…</span>;
}
```

### Writing tweaks programmatically

```tsx
const { setTweak } = useTweaks();
<button onClick={() => setTweak("theme", "light")}>Light mode</button>
```

### Non-React escape hatch

The provider emits `window` events on every change:

```ts
window.addEventListener("tweaks:change", (e: CustomEvent) => {
  console.log("tweaks are now", e.detail);
});
```

Useful for vanilla modules, iframes, or analytics.

### Customizing / constraining

- Remove options you don't want users touching — delete from `OPTIONS` in
  `tweaks.tsx` (e.g. keep `theme` but hide `warmth` from the panel).
- For a published product, gate `<TweaksPanel>` behind a feature flag or
  an admin-only route.
- For per-user persistence (not per-device), replace the
  `localStorage.setItem` calls with a POST to your user-prefs endpoint.

---

## Layer 3 — Component ports

**Goal:** translate each pane from the mock into real React, one at a time.
`RunsPane.tsx` is the worked example. Use it as a template.

### Anatomy of a port

Every pane in the mock has the same skeleton — copy it for Tools, DoJo,
Comfy, Voice:

```tsx
export function MyPane() {
  const { data } = useMyData();           // ← your data hook (replace placeholder)
  return (
    <div className={styles.stage}>         {/* full-bleed container */}
      <Header />                            {/* eyebrow + title + actions */}
      <Meters />                            {/* optional — KPI row */}
      <Filters />                           {/* optional — pill row */}
      <div className={styles.split}>        {/* main + side panel */}
        <List />
        <Detail />
      </div>
    </div>
  );
}
```

### What to do with the demo data in `RunsPane.tsx`

`demoRuns()`, `deriveMeters()`, and `demoTrace()` at the bottom of
`RunsPane.tsx` are **placeholders**. Replace the two hooks at the top:

```tsx
function useRuns() {
  const { data } = useSWR("/api/runs", fetcher);   // ← your real call
  return {
    runs: data?.runs ?? [],
    meters: data?.meters ?? zeroMeters,
    isLoading: !data,
    error: null,
  };
}

function useRunTrace(runId: string | null) {
  const { data } = useSWR(runId ? `/api/runs/${runId}/trace` : null, fetcher);
  return { events: data?.events ?? [], isLoading: !data };
}
```

The view layer below the hooks stays completely untouched. The `Run` and
`TraceEvent` types in `RunsPane.tsx` describe the minimum shape the view
needs; adapt your API response to that shape in the hook.

### Styles: CSS Modules vs Tailwind

`RunsPane.module.css` uses CSS Modules — scoped classes, zero collisions.
If you prefer Tailwind, rewrite the component with utility classes; every
raw value in the CSS module has a direct Tailwind equivalent because the
config points at the same CSS variables. Example translation:

```css
/* RunsPane.module.css */
.meter {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
}
```

```tsx
// Tailwind equivalent
<div className="bg-bg-card border border-border rounded-lg p-4" />
```

### Porting the other four panes

Each pane in the mock maps to one React component file. Suggested order:

| Pane   | Difficulty | Core patterns                                   |
|--------|------------|--------------------------------------------------|
| Runs   | easy       | table + filters + side panel (done — template) |
| Tools  | medium     | gauges (SVG), health grid, tool registry table  |
| Voice  | medium     | animated waveform, transport controls           |
| Comfy  | medium     | workflow picker + gallery + filter chips        |
| DoJo   | hard       | dynamic specimen switching (spec → component)   |

For DoJo specifically: the specimen index should drive a `Map<id, Component>`
lookup, and each specimen file should live alongside its real component
source — `src/components/Button/Button.tsx` + `src/components/Button/Button.specimen.tsx`.

---

## The migration plan (practical)

1. **PR 1 — tokens.** Layer 1 only. No component changes. Ship it.
2. **PR 2 — tweaks infra.** Layer 2. Wire provider; hide panel in prod.
3. **PR 3 — Runs pane.** Layer 3, first component. Replace placeholder
   hooks with real data. This PR validates the token system works under
   real data and proves out the port recipe.
4. **PRs 4–7 — remaining panes.** One per PR, same pattern. Each reviewer
   has one file to read; diffs stay small.

Each PR is independently revertable. No PR depends on a later PR.

---

## QA checklist per PR

- [ ] All colors resolve through `var(--*)` — no raw hex in component files
- [ ] `data-theme="light"` doesn't break layout (flip and eyeball)
- [ ] `data-warmth="ember"` + `data-accent="sage"` doesn't break contrast
- [ ] Narrow viewport (~920px) — no horizontal overflow
- [ ] Tokens file imported exactly once (check bundle for duplicates)
- [ ] `useRuns` / `useMyData` hooks replaced with real fetchers
- [ ] TypeScript happy, no `any` escaping the hook boundary

---

## Reference: the mock

The mock HTML file (`Control Deck — Warp direction.html`) is the **visual
source of truth**. When the spec and this handoff disagree, the mock wins —
adjust the handoff. When a tweak is toggled in the mock and the real app
doesn't match, it's a bug in the port, not the tokens.

Keep the mock open in one tab while porting; compare pixel-by-pixel.
