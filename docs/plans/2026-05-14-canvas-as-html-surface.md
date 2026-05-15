# Canvas as the HTML surface — workspace tools suspended

## Decision

Until we re-pitch the workspace, the chat agent gets exactly two surfaces:

1. **The chat thread** — for prose, lists, results.
2. **The canvas** — for anything visual. The canvas is a flexible HTML
   surface. The agent reaches it by calling `execute_code` with
   `language: "html"` and a full markup payload. No pane juggling, no
   "open this then load that" macros.

The nine `workspace_*` tools (`workspace_open_pane`, `workspace_show_canvas`,
`workspace_pane_call`, etc.) are **suspended from the chat agent's toolset**
for now. They stay registered in the bridge (so direct calls and MCP
profiles other than `core` still work) but the chat catalog hides them.

## Why

Two bugs converged in the same session:

- **Tool-naming gravity.** When the user said "send it to canvas", the agent
  picked `workspace_show_canvas` over `execute_code`, because the former
  contains the word "canvas" and the latter buries the canvas behavior in
  its second sentence. The agent then had to call `workspace_reset` +
  `workspace_open_pane` + `workspace_pane_call` to load the HTML — three
  fragile hops where one tool call should suffice.
- **`isRunning` sticks on non-OK.** `lib/hooks/useCanvas.tsx:executeCode`
  has `if (res.ok) { ...flip isRunning false... }` with no `else`. If the
  `/api/code/execute` POST is slow, errors, or 4xx/5xx, the spinner pegs
  at "Running…" forever. Compounds the first bug because the user can't
  even tell whether the agent's hop chain worked.

## The three surgical changes

### 1. `/api/tools/catalog` — hide workspace_* from chat agent

`app/api/tools/catalog/route.ts:buildCatalog()` filters by `BRIDGE_TOOLS`.
Add a second filter that skips names matching `/^workspace_/` unless an
escape hatch query param (`?include=workspace`) is set. This keeps the
direct executor path (`lib/tools/executor.ts` workspace_* cases) live,
keeps MCP profile-based exposure live for external callers, but takes
workspace_* out of the LLM's tool menu for the chat agent.

### 2. `useCanvas.tsx:executeCode` — clear `isRunning` on non-OK

Add the missing `else` branch: on `!res.ok`, set `isRunning: false` and
write `{ stderr: 'execute_code failed: ${status}' }` so the canvas surfaces
the error instead of pegging the spinner.

### 3. `execute_code` description — lead with the canvas behavior

In `lib/tools/definitions.ts:TOOL_DEFINITIONS`, rewrite the `execute_code`
description so HTML/canvas is the headline, not a clause near the end:

> Render code or HTML to the canvas surface beside the chat. For UI,
> pass `language: "html"` with full markup — counters, forms, dashboards,
> games, mockups, anything. Stdout/stderr stream to the output tab. Also
> supports python, lua, go, c, javascript, typescript, bash, react, threejs.

## Starter HTML templates

To give the agent a low-friction starting point when the user asks for
"a small app for X" or "show me Y", the system prompt includes three
shape-only templates. The agent rewrites the body for the specific ask
— the wrapper just provides sensible defaults (dark theme, responsive
container, no external deps).

### A. Single-screen utility (counter / converter / etc.)

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>__TITLE__</title>
<style>
:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; background: #0b0d10; color: #e8eaed;
  font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
.app { max-width: 480px; margin: 4rem auto; padding: 2rem;
  background: #14171b; border-radius: 12px; box-shadow: 0 8px 32px #0008; }
h1 { margin-top: 0; font-weight: 500; letter-spacing: -0.01em; }
button { font: inherit; padding: 0.5rem 1rem; border: 0; border-radius: 6px;
  background: #2563eb; color: white; cursor: pointer; }
button:hover { background: #1d4ed8; }
</style></head>
<body><div class="app"><h1>__TITLE__</h1>__BODY__</div>
<script>__SCRIPT__</script></body></html>
```

### B. List / table viewer

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>__TITLE__</title>
<style>
:root { color-scheme: dark; }
html, body { margin: 0; background: #0b0d10; color: #e8eaed;
  font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
.wrap { max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
table { width: 100%; border-collapse: collapse; background: #14171b;
  border-radius: 8px; overflow: hidden; }
th, td { padding: 0.5rem 0.75rem; text-align: left;
  border-bottom: 1px solid #1f2329; }
th { background: #1a1e23; font-weight: 500; }
tr:last-child td { border-bottom: 0; }
</style></head>
<body><div class="wrap"><h1>__TITLE__</h1>__TABLE__</div></body></html>
```

### C. Canvas drawing surface

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>__TITLE__</title>
<style>
:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; background: #0b0d10; color: #e8eaed;
  font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
  display: flex; flex-direction: column; }
header { padding: 1rem; background: #14171b; border-bottom: 1px solid #1f2329; }
canvas { flex: 1; display: block; background: #0f1217; cursor: crosshair; }
</style></head>
<body>
<header>__TITLE__ — <span id="status">ready</span></header>
<canvas id="c"></canvas>
<script>
const c = document.getElementById('c'), ctx = c.getContext('2d');
function fit() { c.width = c.clientWidth; c.height = c.clientHeight; }
addEventListener('resize', fit); fit();
__SCRIPT__
</script></body></html>
```

## Non-goals

- Not removing workspace tools from MCP profiles. External agents
  asking for `developer` or `desktop-control` still get them.
- Not changing the canvas pane component itself. The bug fix is in the
  hook, not the render tree.
- Not redesigning workspace. It's suspended, not deleted. When we come
  back to it, we'll re-enable per-profile rather than dump nine tools
  into `core`.
