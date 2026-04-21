# workflow: keyboard-drive an app when AT-SPI click fails

Escape hatch for the GTK4 gaps where `native_click` returns
`method: "mouse"` under Wayland (unreliable) or `native_focus` throws
`atspi_error`. Works because `native_key` calls
`Registry.generateKeyboardEvent`, which fires at the X/Wayland compositor
level — independent of the broken a11y Action/Focus paths.

## Prerequisites

1. **The target window must hold keyboard focus.** `native_key` has no
   per-handle targeting. The common pattern is: `native_click` a known-good
   button inside the window first, then chain keys.
2. **Know the app's keyboard shortcut.** Most modern apps publish one. Check
   the app's own menu or the GNOME Shell "Keyboard Shortcuts" dialog.

## Anchor-then-drive pattern

```bash
BRIDGE=http://127.0.0.1:$DECK_PORT/api/tools/bridge
CTX='"ctx":{"thread_id":"t","run_id":"r"}'

# 1. Anchor focus inside the target app by clicking any widget with a working
#    Action. Back / Close / Minimize are safe bets in GNOME apps.
ANCHOR=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_locate\",\"args\":{\"app\":\"$APP\",\"name\":\"Back\",\"role\":\"button\",\"limit\":1},$CTX}" \
  | jq -c '.data.results[0]')
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_click\",\"args\":{\"handle\":$ANCHOR},$CTX}" >/dev/null

# 2. Drive from there. Each call is a single key/combo.
for k in Tab Down Down Down Return; do
  curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
    -d "{\"tool\":\"native_key\",\"args\":{\"key\":\"$k\"},$CTX}" >/dev/null
done
```

## Key spec grammar

A spec is one or more `+`-joined tokens. The last token is the primary key;
anything before it is a modifier pressed-and-held during the primary tap.

| Category | Examples | Notes |
|---|---|---|
| Literal char | `a`, `Z`, `/`, `1`, `.` | Single char → `ord(c)` as X keysym. Case-preserved. |
| Named key | `Return`, `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space` | Case-insensitive. |
| Arrows | `Up`, `Down`, `Left`, `Right` | |
| Navigation | `Home`, `End`, `PageUp`, `PageDown` | |
| Function | `F1`..`F12`, `Menu` | `Menu` is the right-click / context-menu key. |
| Combo | `ctrl+l`, `Ctrl+Shift+T`, `alt+F10`, `super+d`, `ctrl+shift+tab` | Modifiers: `Ctrl`/`Control`, `Shift`, `Alt`, `Super`, `Meta`. |

Invalid specs (`{}`, `ctrl+`, `fkey`) return `{success: false}` with a
descriptive error — no keys are sent.

## Common recipes

### Open a GNOME app's main menu

`F10` is the GNOME keyboard shortcut for the primary menu of the focused app.
Works for Nautilus, gnome-text-editor, gnome-control-center — exactly the
apps where the hamburger button's Action is empty.

```bash
# Anchor, then F10.
curl -s -X POST $BRIDGE ... "$ANCHOR_CLICK" >/dev/null
curl -s -X POST $BRIDGE ... '{"tool":"native_key","args":{"key":"F10"},...}'
```

### Walk a broken sidebar list

gnome-control-center's `AdwNavigationRow` items throw on `grabFocus`. Anchor
with `Back`, `Tab` into the sidebar list, walk with `Down`, commit with
`Return`.

```bash
for k in Tab Tab Down Down Return; do
  curl -s -X POST $BRIDGE ... "{\"tool\":\"native_key\",\"args\":{\"key\":\"$k\"},$CTX}"
done
```

### Fire an app shortcut

```bash
# Nautilus: Ctrl+L → path bar edit mode.
curl -s -X POST $BRIDGE ... '{"tool":"native_key","args":{"key":"ctrl+l"},...}'
# gnome-text-editor: Ctrl+Shift+T → reopen closed tab.
curl -s -X POST $BRIDGE ... '{"tool":"native_key","args":{"key":"ctrl+shift+t"},...}'
```

### Dismiss a popover

```bash
curl -s -X POST $BRIDGE ... '{"tool":"native_key","args":{"key":"Escape"},...}'
```

## Gotchas

- **No acknowledgment.** `native_key` returns `{success: true}` once the X
  event is generated, not once the widget consumed it. Verify via
  side-effect (window title change, new menu items, `queryText` on the
  expected field).
- **Focus races.** If the user alt-tabs between your anchor click and your
  first key, the keys land on the wrong window. Keep the click-then-key
  chain contiguous and short.
- **Modifiers can stick.** The helper releases modifiers defensively even on
  exception, but if Python crashes mid-op your `Shift` can stay held. If
  things start behaving weirdly, fire `{"key":"shift"}` (press-release) as
  a reset.
- **Not a real text path.** `native_key` sends key events; it does not
  insert characters through the a11y text interface. For typing long
  strings into a known-good text widget, use `native_type` — it calls
  `queryEditableText().insertText` and is both faster and more reliable.
  Use `native_key` for shortcuts, navigation, and dismissal only.
