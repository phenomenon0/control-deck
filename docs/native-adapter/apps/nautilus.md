# app skill: Nautilus (org.gnome.Nautilus)

GTK4 file manager. Tested Fedora 43 / GNOME 48 / Wayland.

## Accessible app name

`org.gnome.Nautilus` — note the full D-Bus-style name, not `nautilus`.

## What works

- **Window controls**: "Back", "Forward", "Close", "Minimize", "Maximize" —
  all expose `Action.doAction` with a working `click` action. ✅
- **Volume buttons**: "Eject", "Unmount" — work. ✅
- **Frame title**: `role=frame` → `name` is the current folder's display
  name. Reliable way to verify navigation. ✅
- **Tree walk**: 37 buttons, 18 list items exposed (as of this build). ✅

## What doesn't

- **Main Menu (hamburger) button**: `nActions=0`. Cannot be clicked via
  the Action path. ❌
- **View Options button**: same, `nActions=0`. ❌
- **Current Folder Menu** and other popover triggers: same. ❌
- **Sidebar list items** ("Recent Files", "/home/omen/Documents", …):
  `nActions=0` AND `grabFocus()` raises `atspi_error`. Can't activate via
  AT-SPI at all. Use keyboard (focus sidebar, arrow, Enter) or synthetic
  input. ❌
- **Search Current Folder button**: sometimes 0 actions depending on header
  state. Re-check before relying on it.

## Recipes

### Navigate back in history

```bash
HANDLE=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_locate","args":{"app":"org.gnome.Nautilus","name":"Back","role":"button","limit":1},"ctx":{...}}' \
  | jq -c '.data.results[0]')
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_click\",\"args\":{\"handle\":$HANDLE},\"ctx\":{...}}"
```

Verify: re-locate `role=frame` and read `name` — should change to the previous
folder.

### Enumerate sidebar locations

```bash
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_locate","args":{"app":"org.gnome.Nautilus","role":"list item","limit":50},"ctx":{...}}' \
  | jq -r '.data.results[].name'
```

Returns the visible sidebar entries as `/home/…` absolute paths (or special
labels like "Recent Files").

### Open a specific folder from the sidebar

**Not supported via AT-SPI alone** (list items aren't activatable). Instead:

1. Read the sidebar, pick the target name.
2. Use `xdg-open /path/to/folder` or `gio open file:///path` from the shell.
3. Or use the browser-harness coordinate-click after a screenshot.

## Gotchas

- Nautilus keeps the frame title in sync with the current folder name, so
  before/after title comparison is a reliable click verifier.
- The hamburger menu is effectively AT-SPI-invisible beyond its button label.
  Once you can open it via synthetic input, the resulting popup *does*
  expose its menu items as `role=menu item` with working actions.
- Sidebar rebuilds when you mount/unmount a volume — paths shift. Always
  re-locate.
