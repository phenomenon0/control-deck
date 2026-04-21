# toolkit skill: Qt / QWidget apps

Qt apps (TelegramDesktop, VLC, most KDE apps, VS Code's native menu bar) are
AT-SPI's happy path on Linux. Everything works.

## What works

- **Action.doAction** is wired on essentially every interactable widget.
  Menu items, buttons, toolbar buttons — all clickable via the cascade's
  first strategy. ✅
- **Full tree exposure** — verified 78 buttons, 29 menu items on
  TelegramDesktop.
- **Pixel extents** are reported. They're in **window-local** coordinates
  under Wayland, not desktop coordinates — but still useful for synthetic
  input if you know the window origin.
- **EditableText** on `QLineEdit`, `QTextEdit`. ✅

## What to watch for

- **Window-local vs desktop coordinates.** The `DESKTOP_COORDS` request
  often returns window-relative values under Wayland. Don't feed them to
  `xdotool` expecting absolute screen pixels. Compositor-level synthetic
  input (nut-js) handles this correctly.
- **Menu bar items** (`role=menu item`, direct children of the menu bar)
  open popup menus on `doAction`. The menu items *inside* those popups have
  their own `Action` wired, so chain two clicks to pick something like
  File → Quit.
- **Qt uses `role=push button` for some buttons** and `role=button` for
  others, inconsistent across Qt versions. Locate with both if unsure.

## Recipes

### Click a menu-bar item

```bash
# TelegramDesktop example: open the "File" menu
HANDLE=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_locate","args":{"app":"TelegramDesktop","name":"File","role":"menu item","limit":1},"ctx":{...}}' \
  | jq -c '.data.results[0]')
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_click\",\"args\":{\"handle\":$HANDLE},\"ctx\":{...}}"

# Now enumerate the popup:
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_locate","args":{"app":"TelegramDesktop","role":"menu item","limit":30},"ctx":{...}}'
```

### Read the text of a message input

`QTextEdit` exposes as `role=text`. Locate by `app + role=text`, pass the
handle to `native_type` to compose, or query `queryText()` directly in
python to read.

## Performance note

Qt's AT-SPI bridge is cheap and the helper's walk cap (2000 nodes) never
hits on typical Qt apps. Don't hesitate to call `native_tree` on a whole
Qt application — it returns quickly.
