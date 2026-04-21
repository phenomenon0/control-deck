# toolkit skill: GTK4 / libadwaita apps

GTK4 exposes AT-SPI inconsistently. The tree walks, locate works, but action
registration is patchy and Wayland breaks coordinate-based fallbacks.

Tested apps: Nautilus, gnome-text-editor, gnome-control-center. See per-app
pages for specifics.

## What works

- **Tree walk + locate.** Every visible widget appears with a role + name.
- **`Action.doAction` on "classic" buttons** — "Back", "Forward", "Close",
  "Minimize", "Maximize", "Eject", "Unmount". These inherited working
  action wiring from GTK3-era patterns.
- **`EditableText` interface** on `GtkTextView` and `GtkEntry`. Insert and
  delete work reliably. ✅
- **Frame-title read** for navigation verification.

## What breaks

- **Popover triggers** (hamburger "Main Menu" button, kebab "View Options",
  date pickers, combo triggers): report `Action` interface but
  `nActions == 0`. The click cascade falls through to broken mouse fallback.
- **`AdwNavigationRow` sidebar items** in libadwaita sidebars (Settings'
  Wi-Fi/Bluetooth/Network/etc.): same `nActions=0`. Additionally, their
  `Component.grabFocus()` raises `atspi_error` — so even the focus+Enter
  fallback is unavailable.
- **List items in `GtkListView`** (Nautilus sidebar, file-picker lists):
  same profile — `nActions=0` + `grabFocus` error.
- **`Component.getExtents(DESKTOP_COORDS)` under Wayland**: returns zeros or
  window-local values depending on widget. Synthetic mouse click at those
  coords lands in the top-left corner of the screen.

## Workaround strategies

In order of preference:

1. **Find a classic button that does the same thing.** Close/Minimize/Back
   all work — if the task can be expressed through them, use them.
2. **Anchor-then-drive with `native_key`.** Click a working classic button
   in the same window (to bring it focus), then chain `native_key`
   calls — `F10` to open the main menu, `Tab` to walk focus into a broken
   sidebar, arrow keys + `Return` to commit. Keys flow through
   `Registry.generateKeyboardEvent`, independent of the broken
   Action/extents/grabFocus paths. See `workflows/keyboard-navigate.md`.
3. **Use a desktop-level keyboard shortcut** where one exists. `Ctrl+L` to
   focus an address bar, `Ctrl+F` to open find, `Ctrl+,` for preferences —
   these routinely bypass the menu-button gotcha and can be fired directly
   via `native_key` once any widget in the app is focused.
4. **Screenshot + browser-harness coordinate click.** The harness's
   `click(x, y)` goes through the compositor and works on any rendered
   surface, even when AT-SPI is lying.

## Probes you can run

```python
# Does this button have a usable Action?
n.queryAction().nActions  # want > 0

# Can this widget take focus programmatically?
try:
    n.queryComponent().grabFocus()  # True = ok, False = no, raise = broken
except Exception as e:
    print("grabFocus broken:", e)

# Are extents real?
ext = n.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
# Under Wayland on GTK4, (ext.x, ext.y) often == (0,0) or window-local.
```

## Durable role names

GTK4 tends to use:

- `button` (not `push button`)
- `text` for `GtkTextView`, `entry` for `GtkEntry`
- `list item` for `GtkListRow`
- `menu item` for popover menu rows (after the popover is open)
- `frame` for the top-level window
- `panel` for generic containers

## Under Xorg (rare now but sometimes)

Many of these gotchas melt away under Xorg — extents are correct, mouse
fallback works, grabFocus behaves. If you're on Xorg (check with
`echo $XDG_SESSION_TYPE`), the cascade becomes reliable. Fedora/Ubuntu
default to Wayland as of 2025, so Xorg is mostly for verifying whether a
bug is Wayland-specific.
