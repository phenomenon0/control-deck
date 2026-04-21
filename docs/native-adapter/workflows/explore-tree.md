# workflow: explore an unknown app's a11y tree

Run before writing automations against a new app. Goal: learn which roles,
names, and paths are stable enough to target.

```bash
BRIDGE=http://127.0.0.1:$DECK_PORT/api/tools/bridge
CTX='"ctx":{"thread_id":"t","run_id":"r"}'
APP="gnome-text-editor"  # the accessible app name, not the binary

# 1. Full tree (limited to ~6 depth, 40 children per node by the helper)
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_tree\",\"args\":{\"handle\":{\"id\":\"$APP::$APP\",\"role\":\"application\",\"name\":\"$APP\",\"path\":\"$APP\"}},$CTX}" \
  > tree.json

# 2. Unique roles in this app
jq '.. | objects | .handle.role? // empty' tree.json | sort -u

# 3. All button labels
jq '.. | objects | select(.handle.role=="button") | .handle.name' tree.json | sort -u

# 4. All text/entry widgets
jq '.. | objects | select(.handle.role | test("^(text|entry|paragraph)$")) | .handle' tree.json
```

## What to write down for the app

After the scan, note:

1. **Accessible app name** — what goes in `"app":"..."` filters. Often
   differs from the binary. Examples: `org.gnome.Nautilus` (not `nautilus`),
   `gnome-text-editor`, `TelegramDesktop`, `Google Chrome`.
2. **Role vocabulary** — does it use `button` or `push button`? `text` or
   `entry`? Each toolkit picks different names.
3. **Which buttons have `Action.doAction` registered.** Use the probe script:

   ```python
   import pyatspi
   d = pyatspi.Registry.getDesktop(0)
   for i in range(d.childCount):
       app = d.getChildAtIndex(i)
       if app and app.name == APP:
           def walk(n, depth=0):
               if depth > 6: return
               if n.getRoleName() in ("button", "push button", "menu item"):
                   try:
                       nActions = n.queryAction().nActions
                       print(f"{n.name[:40]:40} {n.getRoleName():12} actions={nActions}")
                   except Exception: pass
               for j in range(n.childCount):
                   try: walk(n.getChildAtIndex(j), depth+1)
                   except Exception: pass
           walk(app)
   ```

4. **Paths that are stable.** Run the scan twice with 3-5s between. Paths
   that shift between runs are unstable (animations, async loads). Use
   name+role filtering instead of path-matching for those.

## Signals this app is a bad AT-SPI target

- Application shows up but `childCount == 0` after ≥ 2 s: the app doesn't
  expose its UI. Common: gnome-calculator under Wayland, Chrome without
  `--force-renderer-accessibility`.
- `role` vocabulary is only `frame` and `panel`: you're seeing window chrome,
  not content. VTE terminals behave this way.
- Every button reports `nActions == 0`: GTK4 on a toolkit version that
  didn't wire AtkAction. Prefer keyboard-driven navigation.

If you hit any of these, switch harnesses — browser-harness for Chromium,
PTY for terminals, synthetic input + screenshots for canvas apps.
