# app skill: GNOME Text Editor (gnome-text-editor)

GTK4. Deep AT-SPI exposure for the document, shallow for the chrome.

## Accessible app name

`gnome-text-editor`

## What works

- **Single `role=text` node per window** = the active document's text view.
  Editable via `native_type`. ✅
- **Button tree**: 31 buttons (Find/Replace toolbar, menu triggers, etc.).
- **EditableText interface** on the text view: insert + delete + caret
  position all work. ✅

## What doesn't

- The top hamburger menu has the same GTK4-popover gotcha as Nautilus. Use
  keyboard shortcuts (`Ctrl+S`, `Ctrl+N`, etc.) via synthetic input instead.
- The draft autosave list (recently-opened) doesn't show up as list items.

## Recipes

### Read the document's current text

```python
import pyatspi
d = pyatspi.Registry.getDesktop(0)
for i in range(d.childCount):
    app = d.getChildAtIndex(i)
    if app and app.name == "gnome-text-editor":
        # find the text node (deepest role=text)
        from collections import deque
        q = deque([app])
        while q:
            n = q.popleft()
            if n.getRoleName() == "text":
                t = n.queryText()
                print(t.getText(0, t.characterCount))
                break
            for j in range(n.childCount):
                q.append(n.getChildAtIndex(j))
```

### Prepend text to the document

```bash
HANDLE=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d '{"tool":"native_locate","args":{"app":"gnome-text-editor","role":"text","limit":1},"ctx":{...}}' \
  | jq -c '.data.results[0]')
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_type\",\"args\":{\"handle\":$HANDLE,\"text\":\"new header line\\n\"},\"ctx\":{...}}"
```

Text is inserted at the current caret. If caret is at position 0, the text
lands at the very top. Use `Ctrl+Home` via synthetic input first to move
the caret if needed.

### Clean up after a test insertion

Use pyatspi's `EditableText.deleteText(start, end)` directly — not exposed
via `native_*` tools yet.

## Verification

- Frame title includes the filename and edit-state (`•` if dirty).
- `queryText().getText()` reflects what AT-SPI sees, which matches the buffer
  including unsaved edits.
