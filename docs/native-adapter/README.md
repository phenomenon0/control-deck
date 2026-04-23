# native-adapter docs

How to drive external native apps from control-deck.

| Platform | Backend                           | Status |
|----------|-----------------------------------|--------|
| Linux    | AT-SPI via python `scripts/atspi-helper.py` + xdg portals | Shipping |
| macOS    | AXUIElement via compiled Swift helper    | Shipping |
| Windows  | UI Automation via `WinAutomationHost.exe` (C# / FlaUI) | Shipping |

All three expose the same nine `native_*` tools (locate, click, type,
tree, key, focus, screen_grab, focus_window, click_pixel). Windows
additionally exposes five UIA-only extras — see [windows.md](./windows.md).

Start with [SKILL.md](./SKILL.md) — tool contracts, click cascade, framework
matrix, gotchas.

## Workflows

End-to-end flows with copyable curl + `jq` snippets:

- [click-button.md](./workflows/click-button.md)
- [type-into-field.md](./workflows/type-into-field.md)
- [explore-tree.md](./workflows/explore-tree.md) — survey a new app first
- [keyboard-navigate.md](./workflows/keyboard-navigate.md) — escape hatch
  when GTK4 click fails: anchor focus, then drive with `native_key`.

## Per-app / per-toolkit notes

What actually works on real apps:

- [GTK4 / libadwaita](./apps/gtk4.md) — Nautilus, gnome-text-editor,
  gnome-control-center. Tree works, actions patchy.
- [Qt / QWidget](./apps/qt.md) — TelegramDesktop, KDE apps. Happy path.
- [Chromium / Electron](./apps/chromium.md) — use CDP instead.
- [Nautilus](./apps/nautilus.md) — specific button catalogue.
- [gnome-text-editor](./apps/gnome-text-editor.md) — EditableText recipes.

## Pattern

```
┌────────────┐  locate  ┌────────────┐  act  ┌────────────┐
│  /api/     │ ───────→ │  pick by   │ ────→ │  /api/     │
│ tools/     │          │ name+role  │       │ tools/     │
│ bridge     │ ←── handle │           │       │ bridge     │
└────────────┘          └────────────┘       └────────────┘
                                                    │
                                                    ↓
                                              verify side-effect
                                              (title change, new
                                              menu items, text)
```

Every flow follows this shape — there is no shortcut that skips locate.
Handles contain an index-path that is only meaningful *for the running app
instance*. Don't persist them across restarts.

## Always contribute back

When you discover a quirk in a new app, add a short page under `apps/` with:
- accessible app name (the `app: ...` filter value)
- what works / what doesn't
- 1-2 concrete recipes
- traps specific to this app

Keep it under 100 lines. The goal is shared memory, not a manual.
