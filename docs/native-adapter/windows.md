# Windows native-adapter

UI Automation (UIA) sidecar for driving Windows apps.

## Stack

```
lib/tools/native/windows-uia.ts           NativeAdapter implementation
  ├── windows-host-client.ts              JSON-RPC client (stdio, Content-Length framed)
  │     └── spawns → WinAutomationHost.exe
  │                    └── C# / FlaUI (UIA3)
  └── windows-input.ts                    koffi FFI → user32.dll
                                          node-screenshots → DXGI capture
```

The C# host handles the accessibility-tree work (UIA's COM surface is
ugly from FFI; FlaUI is the mature wrapper). The Node side handles
input injection (SendInput), window focus (AttachThreadInput +
SetForegroundWindow), and screen capture (node-screenshots, DXGI).

## Build

```powershell
bun run electron:win-host
```

Runs `dotnet publish -c Release -r win-x64 --self-contained
-p:PublishSingleFile=true` on `win-host/`, copies the resulting
`WinAutomationHost.exe` (~20 MB, zero runtime dependency) into
`electron/resources/win/`.

Wired into `electron:dev` and `electron:build` so it runs automatically
on Windows. On Linux/macOS the script exits 0 without doing anything.

Prereq: `.NET 8 SDK` or newer (10 works; the csproj currently targets
`net10.0-windows` because that's what was available — swap if you want
LTS).

## The nine tools (parity surface)

| Tool | Implementation |
|---|---|
| `native_locate` | Host walks UIA tree with name/role/app substring filters |
| `native_click` | Host cascade: `InvokePattern` → `TogglePattern` → `SelectionItemPattern` → focus+`VK_RETURN`. If no pattern applies, Node falls back to `SendInput` mouse at the element's bounding-rect center. |
| `native_type` | Host tries `ValuePattern.SetValue`; falls through to Node-side `SendInput` Unicode scancodes |
| `native_tree` | Host TreeWalker bounded by depth (default 20) |
| `native_key` | Node `SendInput` — VK codes + modifiers for combos, `KEYEVENTF_UNICODE` for chars |
| `native_focus` | Host `AutomationElement.Focus()` |
| `native_screen_grab` | Node `node-screenshots` → PNG → base64 |
| `native_focus_window` | Node: HWND resolved by window-title substring match against `app_id`, then `AttachThreadInput` + `SetForegroundWindow` |
| `native_click_pixel` | Node `SendInput` with `MOUSEEVENTF_ABSOLUTE \| MOUSEEVENTF_VIRTUALDESK`, coords normalized to 0..65535 |

## Windows-only extras

These exploit UIA's semantic surface — no AT-SPI / AX equivalent:

1. **`native_invoke`** — dispatch a UIA control pattern directly
   (`Invoke`, `Toggle`, `ExpandCollapse`, `RangeValue.SetValue`,
   `Value.SetValue`, `SelectionItem.Select`, `Window.Close`). Skips
   synthetic input; far more reliable than click cascade for ribbon
   menus, treeviews, spinners, and anything where focus side-effects
   matter.
2. **`native_wait_for`** — subscribe to UIA
   `StructureChangedEvent` / `AutomationFocusChangedEvent` /
   `AutomationPropertyChangedEvent`, resolve when a matching element
   fires. Replaces polling loops.
3. **`native_element_from_point`** — resolve the UIA element at a
   desktop pixel coord. Turns "where did the user click?" into a
   semantic handle.
4. **`native_read_text`** — read `TextPattern.DocumentRange` from a
   document-like control (Word, Notepad, browser text input). Includes
   current selection.
5. **`native_with_cache`** — batch multiple sub-ops (locate, tree,
   read_text) against a cached subtree in one round-trip. 10-100×
   faster than cold tree walks for large surfaces (Explorer, Outlook).

All five are declared as **optional methods** on `NativeAdapter` —
Linux/macOS return `unsupported_platform` cleanly.

## Known limitations

- **UAC / UIPI:** an unelevated Electron process cannot automate
  elevated windows (Task Manager, Registry Editor, admin cmd). Input
  is silently dropped by UIPI. The adapter does not try to work around
  this — a UIAccess manifest would require an Authenticode EV cert +
  install to `%ProgramFiles%`, which is the wrong trade-off for this
  app. If you need admin-app automation, run Control Deck itself
  elevated.
- **Foreground lock:** `SetForegroundWindow` fails when another app
  owns the foreground. We use the `AttachThreadInput` pattern which
  handles ~90% of cases. Full-screen exclusive apps (games) block it.
- **RuntimeId instability:** UIA runtime IDs are only stable for an
  element's lifetime. The host uses an indexed-path key (`"<process>::
  0/2/1/3"`) as the wire-stable handle and re-walks from the process
  root on cache miss.
- **HDR:** `node-screenshots` returns 8-bit BGRA; HDR content is
  tone-mapped by DWM for capture. Fine for screenshots; not reliable
  for pixel-exact color sampling.
- **Per-monitor DPI:** both the Electron app and the UIA host are
  marked `PerMonitorV2` in their manifests. If you add more native
  helpers, declare them the same way or bounding rects will come back
  virtualized.
- **`focus_window` matching:** currently matches by window-title
  substring (`"notepad"` finds any Notepad window, `"telegram"` finds
  Telegram Desktop). AUMID-based resolution is a future enhancement;
  the current approach covers the common case.

## Verifying a fresh install

After `bun install` + `bun run electron:win-host`, exercise the
pipeline with Notepad open:

```bash
# (from any Electron-running shell with CONTROL_DECK_PORT set)
BRIDGE=http://127.0.0.1:$CONTROL_DECK_PORT/api/tools/bridge

curl -s -X POST $BRIDGE -H 'Content-Type: application/json' -d '{
  "tool":"native_locate",
  "args":{"app":"Notepad","name":"File","role":"menu"},
  "ctx":{"thread_id":"t","run_id":"r"}
}'

# then use the returned handle with native_invoke to fire the menu
# without synthesizing a click:
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' -d '{
  "tool":"native_invoke",
  "args":{
    "handle": <handle from locate>,
    "pattern":"Invoke",
    "action":"Invoke"
  },
  "ctx":{"thread_id":"t","run_id":"r"}
}'
```

## Files

- `win-host/` — C# sidecar project (net10.0-windows, FlaUI 5)
- `lib/tools/native/windows-uia.ts` — NativeAdapter impl
- `lib/tools/native/windows-host-client.ts` — JSON-RPC stdio client
- `lib/tools/native/windows-input.ts` — koffi SendInput + window mgmt
- `lib/tools/native/keysym.ts` — shared keysym → VK mapping
- `electron/services/windows-host.ts` — Electron main hook (env + cleanup)
- `scripts/build-win-host.cjs` — invokes `dotnet publish` + stages exe
