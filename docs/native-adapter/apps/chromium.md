# app skill: Chromium (Chrome, Edge, Electron, control-deck)

**Short version: AT-SPI is the wrong tool for these apps. Use CDP.**

## What AT-SPI can see

Exactly the window frame's title. Chromium gates its renderer accessibility
tree behind a startup flag or screen-reader activation event. Without that,
the DOM / React tree / widgets are invisible to AT-SPI.

```
application     Google Chrome
  frame           New Incognito Tab - Google Chrome (Incognito)
  frame           🟢 localhost - Network error - Google Chrome
```

Every page, every button, every input field: not exposed.

## Why

- Chromium keeps accessibility off by default for performance. A large page
  can add 20-50 ms to layout when the a11y tree is maintained.
- It enables itself when a screen reader (Orca, NVDA, VoiceOver) signals
  activation on the bus, or when the renderer was started with
  `--force-renderer-accessibility`.
- Electron inherits this wholesale. `control-deck` itself shows up in
  AT-SPI only as a `control-deck` application with one `Control Deck` frame.

## What to do instead

### For Chrome / Edge / Chromium browsers

Use the browser-harness (`~/Documents/INIT/ai_tools/browser-harness/`). It
attaches via CDP on `localhost:9222` and gives you screenshots, coordinate
clicks, DOM queries, and network inspection.

### For Electron apps

Two options:

1. **Own Electron main process**: use `webContents.debugger` — native CDP
   without an external Chrome. control-deck can do this for hidden
   `BrowserWindow`s spawned by the agent.
2. **External Electron apps** (VS Code, Slack, Discord, …): launch them with
   `--remote-debugging-port=9229` and attach the browser-harness.

### When you actually need AT-SPI for Chromium

Launch with `--force-renderer-accessibility`:

```bash
google-chrome --force-renderer-accessibility &
```

The full DOM then materialises as AT-SPI roles: `document web`, `internal
frame`, `link`, `text`, `push button`, etc. Performance hit is real — only
do this when CDP isn't an option.

## Gotchas

- Chrome flags are **per-process**. If Chrome is already running without
  the flag, a new invocation won't enable a11y — you have to close all
  Chrome windows first.
- `--force-renderer-accessibility` enables the tree but not ARIA attributes
  on third-party sites. Some sites still don't expose role info even with
  this flag.
- The app name reported by AT-SPI is `Google Chrome`, `Google Chrome`
  (Canary), `chromium`, or `Microsoft Edge` depending on the binary. Match
  with a substring, not exact equality.
