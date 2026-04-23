# native-adapter

How to drive external native apps from control-deck via the `native_*` tool
family. **Read this file in full before using or editing the adapter** — it
has to be in context.

## Fast start

All calls go through the same HTTP bridge Agent-GO and internal tools use:

```bash
BRIDGE=http://127.0.0.1:$DECK_PORT/api/tools/bridge
# 1. Locate → returns a list of handles with index-path ids.
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_locate",
       "args":{"app":"org.gnome.Nautilus","name":"Back","role":"button","limit":1},
       "ctx":{"thread_id":"t","run_id":"r"}}'

# 2. Click → pass the whole handle object back verbatim.
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_click\",\"args\":{\"handle\":$HANDLE},\"ctx\":{...}}"
```

The adapter is `lib/tools/native/linux-atspi.ts`; it spawns
`scripts/atspi-helper.py` once per call with a JSON command on stdin. The
helper resolves via pyatspi and prints a JSON result on stdout.

**Handles look like:** `{"id":"<app>::<app>/<idx>/<idx>/…","role":"…","name":"…","path":"<app>/<idx>/<idx>/…"}`.
The path is the index of each node inside its parent, rooted at the top-level
application. `id` is `"<app_name>::<path>"`. Passing a fake id like `"id":"x"`
breaks resolution — always echo the whole handle returned by `native_locate`.

## The nine tools

| Tool | Args | Returns |
|---|---|---|
| `native_locate` | `{name?, role?, app?, limit?}` (any subset) | `{platform, results: NodeHandle[]}` |
| `native_click` | `{handle: NodeHandle}` | `{method: "action"\|"focus+enter"\|"mouse"}` |
| `native_type` | `{handle?: NodeHandle, text: string}` | `{typed: number}` |
| `native_tree` | `{handle?: NodeHandle}` | `{platform, tree: TreeNode}` |
| `native_key` | `{key: string}` (char, keysym, or `"ctrl+shift+t"` combo) | `{key: string}` |
| `native_focus` | `{handle: NodeHandle}` | `{focused: boolean}` |
| `native_screen_grab` | `{}` | `{pngBase64, width, height}` — via xdg-portal Screenshot |
| `native_focus_window` | `{app_id: string}` (e.g. `"org.telegram.desktop"`) | `{dispatched: boolean, log: string}` |
| `native_click_pixel` | `{x: number, y: number, button?: "left"\|"right"\|"middle"}` | `{}` — absolute-coord click via RemoteDesktop+ScreenCast |

- `limit` defaults to 10; raise it when enumerating (e.g. listing all buttons).
- Match on `name` and `role` is substring + case-insensitive; `app` is matched
  against the top-level application name.
- `native_click` cascades through three strategies; see **Click cascade** below.
- `native_type` requires an editable-text handle (role contains "text" or
  "entry"). Without a handle, it errors — use `native_key` to drive the
  focused window instead.
- `native_key` sends to **whatever has keyboard focus right now** — there is
  no per-handle targeting. Bring focus first (via `native_click`,
  `native_focus`, or user action) then fire the key. Modifier combos use `+`
  as separator: `ctrl+shift+t`, `alt+F10`, `super+l`.
- `native_focus` calls AT-SPI `grabFocus`. Qt widgets respect it; **GTK4
  widgets consistently fail with `atspi_error`** (known toolkit bug). Use
  `native_click` on a focusable sibling instead when focus fails.
- `native_screen_grab` uses `org.freedesktop.portal.ScreenCast` via a Python
  helper (`scripts/screencast-capture.py`) spawned from Electron main. First
  call shows the user a permission dialog; subsequent calls are silent
  (~250 ms) thanks to a persisted `restore_token` at
  `<userData>/portal-screencast.token`. Returns a base64 PNG — do not
  re-encode it on the way back to the LLM (the executor already excludes it
  from glyph wrap). Falls back to the stateless Screenshot portal if the
  helper is missing or the user denies permission.
- `native_focus_window` raises an app by desktop `app_id` using an
  `xdg_activation_v1` token minted via a tiny GDK helper (`scripts/wl-activate.py`
  spawned from Electron main). Works reliably on GNOME Mutter and KWin; ignored
  silently by compositors without `xdg_activation_v1`. Use it before
  `native_key` / `native_type` to guarantee the target window has focus.
- `native_click_pixel` is the Wayland-compatible mouse. It uses the
  RemoteDesktop portal plus a ScreenCast stream to resolve absolute desktop
  coordinates, so it bypasses the broken AT-SPI mouse fallback and the
  window-local extents problem. Coordinates are **desktop pixels** (matching
  `native_screen_grab`'s PNG). Lazy-inits on first call — expect a one-time
  screen-share permission dialog. Never shown again after the user checks
  "remember".

## Status & coverage (2026-04)

Two platforms are live: **Linux** (AT-SPI + xdg-desktop-portal via Python
helpers) and **macOS** (AX + CGEvent via a compiled Swift helper).
Reliability depends on the compositor/portal backend on Linux, and on the
user having granted Accessibility + Screen Recording permissions on macOS.
Treat the matrices below as the source of truth — not the tool table above.

### Linux — working (verified)

| Tool | Surface | Notes |
|:---|:---|:---|
| `native_locate` | AT-SPI via `scripts/atspi-helper.py` | Stable across Qt/GTK3. GTK4 partial (see Framework matrix). |
| `native_click` | AT-SPI Action → focus+Enter → mouse cascade | Qt is reliable; GTK4 mostly falls through to cascade stage 2. |
| `native_tree` | AT-SPI | Stable. |
| `native_focus` (AT-SPI `grabFocus`) | AT-SPI | Qt reliable; GTK4 throws `atspi_error` — known toolkit bug, use keyboard navigation instead. |
| `native_focus_window` | `scripts/wl-activate.py` (GDK + xdg_activation_v1) | Reliable on GNOME Mutter; verified against Telegram and GTK4 apps. |
| `native_screen_grab` | `scripts/screencast-capture.py` (ScreenCast portal + gst-launch) | Silent after first accept, ~250 ms per call. Requires `gst-launch-1.0 pipewiresrc pngenc` and `dbus-python`. |
| `native_key`, `native_type`, `native_click_pixel` | `scripts/remote-desktop.py` (long-lived Python daemon, RemoteDesktop portal) | One-time permission prompt on first launch; silent thereafter. Key+type share one keyboard-only session (persists across restarts via `restore_token`). Pixel clicks use a combined RD+ScreenCast session that re-prompts per launch (GNOME rejects persist_mode on combined sessions). |

### macOS — working

| Tool | Surface | Notes |
|:---|:---|:---|
| `native_locate` | `AXUIElementCopyAttributeValue` via `scripts/macos-ax-helper.bin` (Swift) | Walks running apps filtered by bundle id / localized name; DFS with limit cap. |
| `native_click` | `kAXPressAction` → focus+Return → CGEvent mouse cascade | AXPress works for nearly all native buttons, menu items, links. Focus+Return handles default buttons inside dialogs. CGEvent mouse is final fallback for non-accessible widgets. |
| `native_type` | `AXUIElementSetAttributeValue(kAXValueAttribute, …)` with CGEvent unicode fallback | Direct AXValue write is instant even for long strings; CGEvent fallback handles non-text elements and the handle-less "type at caret" path. |
| `native_tree` | AX tree serialization via helper | Bounded by depth arg (default 20) so deep SwiftUI trees don't explode. |
| `native_key` | CGEvent keyboard (`CGEventKeyboardSetUnicodeString` for raw chars; `kVK_*` virtual keycodes for named keys + combos) | Modifier masks honored. ASCII-only keycode map for modifier+letter combos (good enough for Cmd+A, Ctrl+Shift+Tab, etc.). |
| `native_focus` | `AXUIElementSetAttributeValue(kAXFocusedAttribute, true)` + `kAXRaiseAction` fallback | |
| `native_focus_window` | `NSRunningApplication.runningApplications(withBundleIdentifier:)` + `.activate(options: .activateAllWindows)` | Works with both bundle identifiers (`com.apple.calculator`) and localized names (`Calculator`). |
| `native_screen_grab` | `/usr/sbin/screencapture -x -t png` shell-out | No native-module dependency. `-x` suppresses shutter sound. |
| `native_click_pixel` | CGEvent mouse at absolute screen coords (left/right/middle) | |

**Permissions:** first call prompts for *Accessibility* (for AX tree + CGEvent) and
*Screen Recording* (for `screencapture`). Prompt copy comes from the
`NSAccessibilityUsageDescription` / `NSScreenCaptureDescription` strings in
`electron-builder.yml`'s `mac.extendInfo`. Until the app is signed and
notarised, macOS shows "Electron" as the grantee, not "Control Deck" — cosmetic
but worth documenting for testers.

**Architecture note:** the Swift helper is deliberately out-of-process (spawned
per call, single JSON request/response) instead of an N-API native addon. Same
rationale as the Python helpers on Linux: Electron ABI bumps don't require
rebuilding, and there's no way to "hang the main process on a system call"
from a separate binary.

### Environment requirements

- `xdg-desktop-portal` (v1.18+) + a matching backend (`xdg-desktop-portal-gnome`
  on GNOME). If the user has `ScreenCast=hyprland` or `Screenshot=hyprland`
  in `~/.config/xdg-desktop-portal/portals.conf` on a non-Hyprland session,
  `native_screen_grab` will fail with "Unknown method". Remove those lines.
- `gst-launch-1.0` with `pipewiresrc` and `pngenc` plugins
  (Fedora: `gstreamer1-plugins-good`, `pipewire-gstreamer`).
- `python3` with `dbus-python` and `gi` (GObject introspection, for
  `Gst`/`Gtk`/`Gio`).
- A Wayland session with `pipewire` running (default on GNOME 42+, KDE 5.27+).

### Known non-coverage

- **Windows**: not implemented. Plan is a per-OS adapter (UIA via FlaUI);
  nothing shipped yet. `unsupportedAdapter` stub returns a clear error.
- **Hyprland, Sway, other wlroots compositors**: portal support is patchy.
  `focus_window` and `screen_grab` may fall back to X11 or fail silently.
- **X11 sessions**: the code paths exist but are untested recently — tier-4
  priority is Wayland-first.
- **macOS Chrome/Electron inner a11y**: same limitation as Linux — Chromium
  only exposes its frame, not the DOM, unless `app.setAccessibilitySupportEnabled(true)`
  is invoked on the target Electron app. Use CDP instead.
- **macOS non-ASCII key combos**: the ASCII→keycode map in the Swift helper
  is US-ANSI only. Composing e.g. `Ctrl+é` on a French keyboard falls back to
  unicode injection (which drops modifiers). Full i18n would need
  `TISCopyCurrentKeyboardInputSource` + `UCKeyTranslate`; not shipped.

## Workflow — the locate → act loop

Every native flow is two or three bridge calls in sequence. Never try to
fabricate a handle; always locate first.

```
┌─────────────┐    ┌──────────────────────┐    ┌─────────────┐
│ locate name │ →  │ pick target by role/ │ →  │ click/type  │
│ + role      │    │ name from results    │    │ with handle │
└─────────────┘    └──────────────────────┘    └─────────────┘
                             │
                             ↓ (if target is unclickable)
                     ┌──────────────────────┐
                     │ locate a sibling/    │
                     │ parent that IS       │
                     │ actionable           │
                     └──────────────────────┘
```

**Rule of thumb:** always pair `native_locate` with the narrowest filter you
can — `app + name + role` — before reaching for the full tree. `native_tree`
is for orientation, not production paths.

## Click cascade

`native_click` tries three strategies in order and returns which fired:

1. **`Action.doAction`** — the a11y toolkit's native click. Preferred names:
   `click | press | activate | jump | open | do default`. Fastest and most
   reliable when available.
2. **`Component.grabFocus` + synthetic `Return`** — focus the node via AT-SPI,
   then send keycode 36 through `Registry.generateKeyboardEvent`. Works for
   things Action misses but that still take focus.
3. **Synthetic mouse click at extent centre** — `Registry.generateMouseEvent`
   at the widget's reported screen centre. **Unreliable under Wayland** (see
   Gotchas). Last resort.

If the result data shows `"method": "mouse"`, treat the click as suspect and
verify the side-effect separately.

## Framework matrix

Findings from real tests against currently-running apps (Fedora 43, GNOME on
Wayland, April 2026):

| Toolkit | Tree | `locate` | Action on buttons | Action on list items | Extents valid | EditableText |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| **GTK4** (Nautilus, gnome-text-editor, gnome-control-center) | ✅ | ✅ | ⚠️ inconsistent | ❌ 0 actions — keyboard-drive with `native_key` | ❌ Wayland returns garbage / window-local | ✅ |
| **Qt / QWidget** (TelegramDesktop) | ✅ | ✅ | ✅ | ✅ menu items | ⚠️ window-local under Wayland | ✅ |
| **Chromium / Electron** (Chrome, control-deck itself) | frame only | frame title only | ❌ no inner a11y | ❌ | n/a | ❌ |
| **GTK3** (older gnome apps) | ✅ | ✅ | ✅ | ✅ | ✅ Xorg; ⚠️ Wayland | ✅ |
| **VTE terminals** (ptyxis, gnome-terminal) | shallow | frame only | ❌ buffer hidden | ❌ | n/a | ❌ |

**What this means in practice:**

- Start with GTK4 buttons that have clear action semantics ("Back", "Forward",
  "Close", "Send", "Play"). Those have `nActions ≥ 1` and work.
- Avoid GTK4 popover triggers (hamburger buttons, kebab menus, `AdwNavigationRow`
  sidebar rows) — they expose `Action` interface but register 0 actions. The
  cascade falls through to broken mouse fallback under Wayland.
- For Qt apps (Telegram, VLC, KDE apps, most IDEs), assume **all** actionable
  widgets have `Action.doAction` wired. It just works.
- For Chromium apps you need CDP — see **When to escape AT-SPI** below.

## When to escape AT-SPI

Use a different harness for these surfaces:

- **Chromium / Electron / Chrome** → use the browser-harness (CDP over
  WebSocket). Control Deck can drive its own Electron windows via the Electron
  main process's `webContents.debugger` API. Launch Chrome with
  `--force-renderer-accessibility` only if you absolutely need AT-SPI
  coverage (perf hit on big pages).
- **Terminal buffers (VTE)** → read/write through the PTY or terminal-service
  directly, not AT-SPI. VTE deliberately doesn't expose cell contents.
- **Canvas-heavy apps (Blender, Figma, Godot)** → AT-SPI sees only the window
  chrome. Use screenshots + coordinate clicks (via nut-js) + app-specific APIs.

## Gotchas (field-tested)

- **Chrome's AT-SPI tree shows only the window title.** Chromium gates its
  renderer accessibility on startup flags or screen-reader activation. Without
  `--force-renderer-accessibility`, DOM is invisible. Plan for CDP instead.
- **Electron apps inherit the same limitation.** control-deck itself shows up
  as `control-deck` with a single `Control Deck` frame and no children.
- **`Component.getExtents(DESKTOP_COORDS)` returns window-local or zero
  coordinates under Wayland** for GTK4 apps. The reported `(x, y)` are not
  screen pixels and the mouse-click fallback lands in the top-left corner.
- **GTK4 `AdwNavigationRow` / nav sidebar rows raise `atspi_error` on
  `grabFocus()`.** The whole click cascade fails silently — Action has 0,
  focus throws, mouse misses. Use `native_click` on a visible **button** in
  the same window to bring focus there, then `native_key` arrows + Enter to
  navigate (see `workflows/keyboard-navigate.md`).
- **`native_focus` returns `{focused: false}` without throwing when grabFocus
  silently no-ops** — Qt usually succeeds, GTK4 usually throws. Treat a
  `false` return as *do not assume focus landed*. Fire a benign key
  (`Escape`) after and verify visually.
- **`native_key` is fire-and-forget against the focused window.** There is no
  targeting — an unrelated window popping up between your `native_click` and
  your `native_key` will eat the keystrokes. Chain them with minimal latency
  and avoid sending keys in a loop if the user might interact.
- **pyatspi lists `Action` in `get_interfaces()` even when `nActions == 0`.**
  Don't trust the interface list; check `nActions` before assuming `doAction`
  will work.
- **VTE terminals (ptyxis, gnome-terminal) expose only shell widgets,
  not the cell buffer.** Read/write via a terminal-service PTY instead.
- **Under Wayland, `at-spi-bus-launcher` can silently lose its socket between
  sessions.** You'll see `dbind-WARNING: Unable to open bus connection`. Calls
  still usually work via the session-bus fallback, but some registry events
  drop. Ignore the warning unless results break.
- **`native_locate` returns substring matches, case-insensitive.** `name: "back"`
  also matches "Go Back", "Playback", "Feedback". Combine with `role` to narrow.
- **Handles expire across window geometry changes** — if the user opens a
  dialog or resizes, re-locate before clicking. Don't cache handles across
  bridge calls you haven't awaited.
- **The helper's handle cache is keyed by UID in `/tmp/control-deck-atspi-<uid>.json`
  with a 60s TTL.** Stale entries are harmless (locate re-walks), but don't
  rely on it for consistency — it's a debug aid.
- **Path indices are stable within a single app's session** but change when
  the app restarts or rebuilds its root view. Always `locate` fresh at the
  start of a workflow.

## Recipes

### Click a button by name

```bash
HANDLE=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_locate","args":{"app":"X","name":"Send","role":"button","limit":1},"ctx":{...}}' \
  | jq -c '.data.results[0]')
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_click\",\"args\":{\"handle\":$HANDLE},\"ctx\":{...}}"
```

### Type into a text field

```bash
HANDLE=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_locate","args":{"app":"X","role":"text","limit":1},"ctx":{...}}' \
  | jq -c '.data.results[0]')
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_type\",\"args\":{\"handle\":$HANDLE,\"text\":\"hello\"},\"ctx\":{...}}"
```

### Explore an app's tree to find a target

```bash
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_tree","args":{"handle":{"id":"X::X","role":"application","name":"X","path":"X"}},"ctx":{...}}' \
  | jq '.data.tree | .. | objects | select(.handle.role=="button") | .handle.name' | sort -u
```

### Keyboard-drive a broken GTK4 sidebar

When a sidebar row reports `Action.nActions == 0` and `grabFocus` throws:

```bash
# 1. Anchor focus in the window by clicking any working button.
BACK=$(curl -s -X POST $BRIDGE ... '{"tool":"native_locate","args":{"app":"gnome-control-center","name":"Back","role":"button","limit":1}, ...}' | jq -c '.data.results[0]')
curl -s -X POST $BRIDGE ... "{\"tool\":\"native_click\",\"args\":{\"handle\":$BACK}, ...}"

# 2. Move to the sidebar list with Tab/Shift+Tab, then walk with arrows.
for k in Tab Down Down Down; do
  curl -s -X POST $BRIDGE ... "{\"tool\":\"native_key\",\"args\":{\"key\":\"$k\"}, ...}"
done
curl -s -X POST $BRIDGE ... '{"tool":"native_key","args":{"key":"Return"}, ...}'
```

### Fire a keyboard shortcut

```bash
# Ctrl+L in the focused file manager → jumps to the path bar.
curl -s -X POST $BRIDGE ... '{"tool":"native_key","args":{"key":"ctrl+l"}, ...}'
```

Valid key specs: single characters (`a`, `1`, `/`), named keys (`Return`,
`Tab`, `Escape`, `Backspace`, `Delete`, `Space`, `Up`/`Down`/`Left`/`Right`,
`Home`/`End`, `PageUp`/`PageDown`, `F1`..`F12`, `Menu`), and `+`-joined
combos with modifiers (`Ctrl`, `Shift`, `Alt`, `Super`, `Meta`).

### Verify a click took effect

AT-SPI gives you back the mechanism (`action` / `focus+enter` / `mouse`) but
not the outcome. Check for side-effects yourself:

- Window title change: re-locate the `frame` role and compare `name`.
- Menu opened: re-locate `menu item` nodes inside the app.
- Text inserted: re-locate the text node and query `queryText().getText()`
  (in Python).
- Page navigation: for Chromium you're in the wrong harness — use CDP.

If `method == "mouse"` and Wayland is active, assume **not applied** until
a side-effect confirms otherwise.

## Architecture

```
Agent-GO / in-app caller
   │
   ▼  POST /api/tools/bridge
app/api/tools/bridge/route.ts   ← BRIDGE_TOOLS whitelist
   │
   ▼  dispatch by tool name
lib/tools/executor.ts           ← executeNative{Locate,Click,Type,Tree,Key,Focus,
   │                                              ScreenGrab,FocusWindow,ClickPixel}
   ▼  getNativeAdapter()
lib/tools/native/index.ts       ← platform router (linux / darwin / win32)
   │
   ▼ linux
lib/tools/native/linux-atspi.ts
   │
   ├──(locate/click/type/tree/key/focus)──► spawn python3 scripts/atspi-helper.py
   │                                         ← pyatspi → AT-SPI bus → running apps
   │
   └──(screen_grab / focus_window / click_pixel)──► HTTP POST $CONTROL_DECK_PORTAL_URL
                                                     (auto-set by electron/main.ts)
                                                    ▼
                                             electron/main.ts portal bridge
                                                    ▼
                           ┌──────────────────────┬─────────────────────────────────┐
                           ▼                      ▼                                 ▼
              screenshot-portal.ts       wl-activator.ts           remote-desktop-client.ts
              (org.freedesktop.          (spawns python3            (Python daemon proxy —
               portal.Screenshot         scripts/wl-activate.py     scripts/remote-desktop.py
               → one-shot PNG)           → xdg_activation_v1 token  RemoteDesktop portal,
                                         → DBus Activate)           key/type/click_pixel)
```

Helper script paths (`atspi-helper.py`, `wl-activate.py`) are resolved in this
order so they work from both dev and the packaged AppImage:

1. `$CONTROL_DECK_SCRIPTS_DIR/<helper>.py` (set by `electron/main.ts`)
2. `$PWD/scripts/<helper>.py` (dev)
3. `$PWD/../scripts/<helper>.py` (Next standalone cwd)
4. `$PWD/../../scripts/<helper>.py`

The portal bridge URL is `$CONTROL_DECK_PORTAL_URL` (set by `electron/main.ts`
on window boot). Calls outside Electron that need `screen_grab` / `focus_window`
/ `click_pixel` must set it explicitly and provide `$CONTROL_DECK_PORTAL_SECRET`.
The three locate/click/type/tree/key/focus tools do not need Electron — they run
fine against any AT-SPI-enabled session.

macOS (`macos-ax.ts`) and Windows (`windows-uia.ts`) are stubs — they throw a
clear error describing what they'd do.

## Extending the helper

Two common reasons to touch `scripts/atspi-helper.py`:

- **New op**: add an `op_*` function and wire it in `main()`. Keep the single
  JSON-in/JSON-out protocol; never break backwards compatibility without also
  updating `linux-atspi.ts`.
- **New click strategy**: add to the cascade inside `op_click`. Preserve the
  ordering (Action → focus+key → mouse) and always return `{"data": {"method":
  "<name>"}}` so callers can surface it.

When you discover a new toolkit quirk, capture it in the **Gotchas** section
above with the exact symptom you saw (role, nActions, Wayland-vs-Xorg, etc.)
— the next agent debugging this should recognise the shape immediately.

## Always contribute back

If you learned something non-obvious about a specific app or toolkit, add a
short section. Examples of what's worth capturing:

- A **framework quirk** — "GTK4 `AdwNavigationRow` has Action interface
  advertised but nActions=0."
- A **stable selector pattern** — "Firefox's URL bar is always role='text'
  with name containing 'Search or enter address'."
- A **trap** — "Telegram's menu-bar items report extents in window-local
  coords, not desktop, under Wayland."
- A **recipe** — the two or three locate calls that reliably open Nautilus'
  hamburger menu via keyboard-only.

Do **not** capture:

- Raw pixel coordinates. Window positions shift; widgets move.
- Per-run narration of what you just did.
- Secrets, tokens, or user-specific paths beyond `$HOME`.

The skill gets better only because the next agent benefits from what this
agent learned.
