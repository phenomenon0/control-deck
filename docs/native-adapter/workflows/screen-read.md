# workflow: read the screen

When you need to see what's on the user's desktop right now — to find a
visible target, confirm a window opened, or pipe a frame into OCR — reach
for `native_screen_grab`. It returns a base64 PNG of the full desktop via
`org.freedesktop.portal.Screenshot`.

## When to use it

- **You can't locate the target via AT-SPI.** Canvas apps, GTK4 popovers
  that never fire accessibility events, Chromium renderers without
  `--force-renderer-accessibility` — all invisible to `native_locate`.
  A screenshot is the universal fallback.
- **You need to verify a side-effect.** "Did the menu open?", "Did the
  toast fire?", "Did the window actually raise?" — one grab answers it
  in a way the AT-SPI tree cannot.
- **You need pixel coordinates for `native_click_pixel`.** The two tools
  are a pair: grab → identify target → click pixel → grab again to verify.

## When NOT to use it

- **Tight polling loops.** Each call is 50–200 ms plus a permission dialog
  on first use. If you're watching for a state change, poll AT-SPI instead.
- **Reading text.** OCR on a full-desktop PNG is expensive and noisy.
  Use `native_tree` for AT-SPI-visible text; use the terminal-service for
  VTE buffers.
- **Before the user has ever granted screen-capture permission.** The
  first call pops a GNOME dialog. If you're running headlessly (CI, remote
  harness), expect this to block.

## Fast start

```bash
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_screen_grab","args":{},"ctx":{"thread_id":"t","run_id":"r"}}' \
  | jq -r '.data.pngBase64' | base64 -d > /tmp/grab.png
identify /tmp/grab.png
```

Response shape:

```json
{
  "success": true,
  "data": {
    "pngBase64": "iVBORw0KGgoAAAA...",
    "width": 3840,
    "height": 2160
  }
}
```

## Locate-by-sight pattern

```
┌──────────────────┐   ┌───────────────────┐   ┌────────────────────┐
│ native_screen_   │ → │ identify target   │ → │ native_click_pixel │
│ grab             │   │ (visual / OCR /   │   │ at (x, y)          │
│                  │   │  vision model)    │   │                    │
└──────────────────┘   └───────────────────┘   └────────────────────┘
        ▲                                                │
        └──────────────  verify step  ───────────────────┘
```

Feed the PNG to whatever pointing oracle fits the task — a vision LLM, a
template match, `tesseract` for OCR, an image hash against known assets.
The oracle's job is to turn "I want to click Send" into `(x, y)`. Then
`native_click_pixel` lands the click at those exact desktop pixels,
which is the same coordinate space the PNG reports.

## Gotchas

- **Width/height are parsed from the PNG IHDR chunk.** If the capture
  tool ever starts returning non-PNG data, the service throws rather
  than silently lying about dimensions.
- **Multi-monitor:** the PNG covers the **entire virtual desktop**, so a
  dual-monitor setup returns a wide PNG containing both screens laid out
  as the compositor sees them. Account for the monitor offsets before
  feeding coordinates to `native_click_pixel` — which uses the same
  coordinate space, so they match if you keep the whole image.
- **Permission is per-app-instance.** If the user "always allow"s the
  first dialog, they won't see it again until the Electron app is
  re-installed or the portal's token store is cleared.
- **The PNG is big.** A 4K single-monitor grab is ~3–8 MB base64. Do
  not stream it back as chat markdown; consume it as a tool artifact.
  The executor already excludes `native_screen_grab` from glyph wrap.
- **Cursor is hidden by default.** The Screenshot portal does not
  include the mouse pointer in its output. If you need cursor position
  for debugging, use AT-SPI or log it separately.

## Verification

```bash
# 1. Grab returns a valid PNG of reasonable size.
SIZE=$(curl -s -X POST $BRIDGE \
  -d '{"tool":"native_screen_grab","args":{},"ctx":{"thread_id":"t","run_id":"r"}}' \
  | jq -r '.data.pngBase64' | wc -c)
[ "$SIZE" -gt 10000 ] || echo "FAIL: grab too small ($SIZE bytes)"

# 2. Width matches xrandr's reported desktop width.
W_GRAB=$(curl -s -X POST $BRIDGE -d '...' | jq '.data.width')
W_XRANDR=$(xrandr --current | awk '/Screen 0/{print $8}')
[ "$W_GRAB" = "$W_XRANDR" ] || echo "WARN: width mismatch ($W_GRAB vs $W_XRANDR)"
```
