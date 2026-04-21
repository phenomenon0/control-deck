# workflow: click at absolute pixel coordinates

When AT-SPI can't see the target, or can see it but can't click it (GTK4
popover triggers with `nActions=0`, Wayland-broken extents, Qt widgets
that refuse external grab), use `native_click_pixel`. It goes through
the RemoteDesktop + ScreenCast portals and lands a real compositor-level
click at absolute desktop coordinates.

## When to use it

- **Canvas-heavy apps** (Blender, Figma-desktop, Godot) — AT-SPI sees
  only the window frame; pixel clicks are the only way in.
- **Broken GTK4 widgets** — hamburger menus, `AdwNavigationRow` sidebar
  rows, popover triggers that advertise `Action` but have `nActions=0`.
  The click cascade in `native_click` falls through to the
  Wayland-broken mouse fallback. `native_click_pixel` bypasses all of
  that.
- **Chromium / Electron** targets when you don't have a CDP harness
  attached. Prefer CDP when you do — it's orders of magnitude more
  reliable.
- **Pairing with `native_screen_grab`** — the two tools share a
  coordinate space. Grab → locate-by-sight → click pixel.

## When NOT to use it

- **AT-SPI can do it.** `native_click` is faster, doesn't require
  portal permissions, doesn't need a PipeWire stream, and gives a
  structured `method` result. Try AT-SPI first.
- **You're reaching for a relative offset from a window.** The portal
  gives you absolute desktop coordinates, not window-local. If the user
  moves the window between grab and click, your pixel goes stale. Re-grab
  if any time passed.
- **Typed input.** Portal keyboard injection is already covered by
  `native_key` and `native_type` — both use the same RemoteDesktop
  session, so once the permission dance is done they're indistinguishable
  from a real keypress.

## Fast start

```bash
# Click at (1920, 540) — centre of a 3840x1080 desktop, say.
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_click_pixel",
       "args":{"x":1920,"y":540,"button":"left"},
       "ctx":{"thread_id":"t","run_id":"r"}}'
```

`button` is optional — defaults to `"left"`. Valid values: `"left"`,
`"right"`, `"middle"`.

Response:

```json
{ "success": true, "data": {} }
```

## How it works under the hood

`native_click_pixel` needs a **PipeWire stream_id** — the ScreenCast
portal's identifier for "which monitor are these coordinates on". The
stream_id is acquired lazily on first call by extending the existing
RemoteDesktop session with `SelectSources` + a combined `Start`, which
returns a streams list (`a(ua{sv})`) that the service parses for the
node ID. The session is then **kept warm for the rest of the Electron
process's lifetime**. Subsequent clicks are ~5 ms DBus roundtrips.

Two things fall out of that:

1. **First click shows a ScreenCast permission dialog.** Even if the
   user has already granted RemoteDesktop for keyboard input, adding
   the ScreenCast source is a separate consent event.
2. **The session survives until app quit.** The restore token is
   persisted at `userData/portal-restore-screencast.token` so the next
   Electron boot reuses it silently if the user checked "remember".

## Locate-by-sight pattern

```
native_screen_grab           → PNG (w, h, bytes)
       │
       ▼
  vision oracle               → "Telegram Send button at (2456, 1890)"
       │
       ▼
native_click_pixel            → click lands
       │
       ▼
native_screen_grab            → verify
```

The oracle can be a vision LLM, a template match, OCR + coordinate
lookup, or the user saying "click there" after a screen share. Whatever
returns `(x, y)` in the same coordinate space as the PNG works.

## Gotchas

- **Coordinate space = desktop pixels, not window-local.** If your
  oracle returns coords relative to a specific window, translate first.
  `native_tree` extents are unreliable under Wayland (see main SKILL.md
  Gotchas) — use the grab's dimensions as your coordinate system.
- **Multi-monitor:** the streams list can contain multiple entries, one
  per monitor. The current service keeps the first one (usually the
  primary); clicks on secondary monitors may miss by the monitor offset.
  If you need secondary-monitor pixel clicks, file it — we'll expose
  stream selection then.
- **The first click is slow.** 200–800 ms for the permission dialog and
  session warmup. Budget for it on the initial user interaction.
- **Double clicks:** there is no native double-click. Call
  `native_click_pixel` twice back-to-back with <250 ms between calls.
  The compositor's click coalescer handles the rest.
- **Drag / hold / release** are not exposed. If you need them, talk to
  the service — the underlying portal supports
  `NotifyPointerMotion(Absolute)` + `NotifyPointerButton` with press
  and release separated; we just haven't surfaced the primitives.
- **Coordinates must be positive integers** bounded by the desktop
  size. The service doesn't clamp — out-of-range coords silently
  do nothing.

## Verification

```bash
# 1. Grab to find the target.
curl -s -X POST $BRIDGE -d '{"tool":"native_screen_grab","args":{},"ctx":{...}}' \
  | jq -r '.data.pngBase64' | base64 -d > /tmp/pre.png

# 2. Click.
curl -s -X POST $BRIDGE \
  -d '{"tool":"native_click_pixel","args":{"x":100,"y":100},"ctx":{...}}'

# 3. Grab again; diff should show a change if the click hit.
curl -s -X POST $BRIDGE -d '{"tool":"native_screen_grab","args":{},"ctx":{...}}' \
  | jq -r '.data.pngBase64' | base64 -d > /tmp/post.png
cmp /tmp/pre.png /tmp/post.png && echo "no change — click missed or had no side effect"
```

For a known side-effect target (e.g. a desktop icon that opens a
folder), follow up with `native_locate` for a `frame` whose name
matches the expected new window — that's a stronger signal than the
pixel diff.
