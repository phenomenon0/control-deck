# workflow: type text into an editable field

For targets that expose `EditableText` (GTK text views, Qt line edits, Adwaita
entries). **Will not work** for Chromium-rendered inputs (see SKILL.md for the
CDP escape hatch).

```bash
BRIDGE=http://127.0.0.1:$DECK_PORT/api/tools/bridge
CTX='"ctx":{"thread_id":"t","run_id":"r"}'

# 1. Find the text node. Filter by app + role first; name is often empty.
HANDLE=$(curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_locate\",\"args\":{\"app\":\"$APP\",\"role\":\"text\",\"limit\":5},$CTX}" \
  | jq -c '.data.results[0]')

# 2. Type. Pass the whole handle back unchanged.
curl -s -X POST $BRIDGE -H 'Content-Type: application/json' \
  -d "{\"tool\":\"native_type\",\"args\":{\"handle\":$HANDLE,\"text\":\"hello world\"},$CTX}"
```

## Role variants you'll see

| Role | Framework | Notes |
|---|---|---|
| `text` | GTK4 `GtkTextView`, Qt `QTextEdit` | Multi-line. `\n` inserts a newline. |
| `entry` | GTK `GtkEntry`, Adwaita rows | Single-line. `\n` is usually ignored. |
| `paragraph` | Rich-text widgets | Sometimes editable, sometimes not — check `STATE_EDITABLE`. |

## Insertion behaviour

`native_type` calls `EditableText.insertText(caretOffset, text, len(text))`:

- Text is inserted at the **current caret position**, not the start of the
  field. If the cursor is at position 0, the text lands at the top.
- The insertion is a **single atomic op** — it shows up as one undoable step
  in the app's undo stack.
- Unicode and newlines pass through as-is; the field must accept them.
- If the field is read-only, you'll get `{"ok": false, "error": "type:
  cannot insert into read-only text"}` — check via `native_tree` and look for
  `STATE_EDITABLE` before typing.

## Verifying insertion

`native_type` only reports character count typed, not content. To verify:

```python
# via pyatspi directly (for debugging)
import pyatspi
desktop = pyatspi.Registry.getDesktop(0)
for i in range(desktop.childCount):
    app = desktop.getChildAtIndex(i)
    if app and app.name == "$APP":
        # walk to your node…
        t = node.queryText()
        print(t.getText(0, t.characterCount))
```

Or re-`native_tree` the field and inspect its text attribute.

## Clean-up after testing

If you're just testing the adapter, **remove what you typed** before
moving on — otherwise the next save in that app persists your test input.

```bash
# Delete the 11 chars we inserted (caret moved past them):
python3 -c "
import pyatspi
d = pyatspi.Registry.getDesktop(0)
# walk to node, then:
# node.queryEditableText().deleteText(0, 11)
"
```

A dedicated `native_delete` op could expose this via the bridge; not wired
yet as of April 2026.
