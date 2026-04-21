# workflow: click a button in an external app

Two-step deterministic flow. Use when you know the button's visible label.

```bash
BRIDGE=http://127.0.0.1:$DECK_PORT/api/tools/bridge
CTX='"ctx":{"thread_id":"t","run_id":"r"}'

# 1. Locate. Narrow with app+name+role.
HANDLE=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_locate\",\"args\":{\"app\":\"$APP\",\"name\":\"$LABEL\",\"role\":\"button\",\"limit\":1},$CTX}" \
  | jq -c '.data.results[0]')

[ "$HANDLE" = "null" ] && { echo "button '$LABEL' not found in $APP"; exit 1; }

# 2. Click. Echo the whole handle back — don't fabricate fields.
RESP=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_click\",\"args\":{\"handle\":$HANDLE},$CTX}")
echo "$RESP" | jq '.'

# 3. Verify: check the side-effect you expected.
# Example — window title changed:
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_locate\",\"args\":{\"app\":\"$APP\",\"role\":\"frame\",\"limit\":1},$CTX}" \
  | jq -r '.data.results[0].name'
```

## When the click silently fails

Symptoms:
- Response is `{"success":true,...}` but nothing happened.
- Method returned is `"mouse"` under Wayland.

Root cause: GTK4 widgets whose Action interface has `nActions=0`. The cascade
falls through to a coordinate click with bad coords.

Recovery:
1. **Find an actionable sibling.** If `Back` button has `nActions=1` and the
   hamburger button doesn't, prefer `Back`. Enumerate all buttons and read
   their action count via `native_tree` + pyatspi if needed.
2. **Drive via keyboard** — the escape hatch for broken GTK4 widgets. Click
   any working button in the same window to anchor focus, then chain
   `native_key` calls (`Tab`, arrows, `Return`, `F10`, `ctrl+shift+t`, etc.)
   to reach and activate the target. See `workflows/keyboard-navigate.md`.
3. **Fall back to browser-harness coordinate click.** `screenshot() → click(x,y)`
   works at the compositor level regardless of toolkit a11y wiring.

## Common button labels that work (observed)

| App | Label | Role | Action semantic |
|---|---|---|---|
| Nautilus | "Back" / "Forward" | button | Navigate history |
| Nautilus | "Close" / "Minimize" / "Maximize" | button | Window control |
| Nautilus | "Eject" / "Unmount" | button | Volume management |
| Telegram | any menu-bar top-level | menu item | Open submenu |
| gnome-text-editor | "New Document" (main menu) | button | New tab |

## Buttons to avoid via AT-SPI

- Hamburger / "Main Menu" buttons on modern GTK4 apps → 0 actions.
- `AdwNavigationRow` sidebar rows (Settings' Wi-Fi/Bluetooth/etc.) → 0 actions.
- Popover triggers in general → `nActions=0` on GTK4 ≥ 4.14.

Drive those with synthetic input or a browser-harness screenshot-click flow.
