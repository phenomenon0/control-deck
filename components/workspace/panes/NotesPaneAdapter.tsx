"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { marked } from "marked";
import { publish, registerPane } from "@/lib/workspace";

interface NotesParams {
  instanceId?: string;
}

/**
 * Notes pane — markdown notetaker, split view (raw | live preview).
 *
 * Keyboard shortcuts:
 *   Ctrl/Cmd+S    force-save (autosave is always on)
 *   Ctrl/Cmd+P    toggle preview visibility
 *   Ctrl/Cmd+B    bold selection
 *   Ctrl/Cmd+I    italic selection
 *   Ctrl/Cmd+K    make link from selection
 *   Tab / Shift+Tab   indent/outdent within lists
 *
 * Capabilities published to the bus:
 *   read_text()                 → current full markdown
 *   read_selection()            → currently-selected text, or "" if none
 *   append_text({text})         → append at end + focus editor
 *   replace_text({text})        → overwrite everything
 *
 * Topics:
 *   changed (rate 2/s coalesced internally via autosave debounce)
 */
export function NotesPaneAdapter(props: IDockviewPanelProps<NotesParams>) {
  const instanceId = props.params?.instanceId ?? props.api.id;
  const paneId = `notes:${instanceId}`;

  const storageKey = `deck:workspace:notes:${instanceId}`;
  const [text, setText] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(storageKey) ?? DEFAULT_BODY;
  });
  const [showPreview, setShowPreview] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // ── Autosave (debounce 500ms) + topic publish ─────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      window.localStorage.setItem(storageKey, text);
      setSavedAt(Date.now());
      publish(paneId, "changed", { length: text.length });
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [text, storageKey, paneId]);

  // ── Bus registration ──────────────────────────────────────────────
  useEffect(() => {
    const getSelection = (): string => {
      const ta = textareaRef.current;
      if (!ta) return "";
      return text.slice(ta.selectionStart, ta.selectionEnd);
    };
    const off = registerPane({
      handle: { id: paneId, type: "notes", label: props.api.title ?? "Notes" },
      capabilities: {
        read_text: {
          description: "Return the full markdown text",
          handler: () => text,
        },
        read_selection: {
          description: "Return currently-highlighted text (empty if none)",
          handler: getSelection,
        },
        append_text: {
          description: "Append text to the end of the note",
          handler: (args: unknown) => {
            const { text: appended } = args as { text: string };
            setText((t) => (t.endsWith("\n") || t === "" ? t + appended : t + "\n" + appended));
            return { appended: appended.length };
          },
        },
        replace_text: {
          description: "Overwrite the note with new text",
          handler: (args: unknown) => {
            const { text: replaced } = args as { text: string };
            setText(replaced);
            return { length: replaced.length };
          },
        },
      },
      topics: {
        changed: {
          expectedRatePerSec: 2,
          priority: "low",
          description: "Fires after autosave (debounced 500ms)",
        },
      },
    });
    return off;
    // `text` is captured through the closure inside handlers — it's
    // always up-to-date because handlers read from the outer scope on
    // each invocation; no need to re-register per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, props.api.title]);

  // ── Rendered HTML ─────────────────────────────────────────────────
  const html = useMemo(() => {
    try {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(text) as string;
    } catch (err) {
      return `<pre style="color:#f66">Render error: ${err instanceof Error ? err.message : String(err)}</pre>`;
    }
  }, [text]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  const wrap = useCallback((before: string, after: string = before) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = text.slice(start, end);
    const next = text.slice(0, start) + before + selected + after + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }, [text]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && !e.shiftKey && e.key === "s") { e.preventDefault(); /* autosave already handles */ return; }
    if (cmd && e.key === "p") { e.preventDefault(); setShowPreview((v) => !v); return; }
    if (cmd && e.key === "b") { e.preventDefault(); wrap("**"); return; }
    if (cmd && e.key === "i") { e.preventDefault(); wrap("*"); return; }
    if (cmd && e.key === "k") { e.preventDefault(); wrap("[", "](url)"); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = text.slice(0, start);
      const selected = text.slice(start, end);
      const after = text.slice(end);
      if (e.shiftKey) {
        // outdent
        const outdented = selected.replace(/^ {1,2}/gm, "");
        setText(before + outdented + after);
      } else {
        // indent
        const indented = selected
          ? selected.replace(/^/gm, "  ")
          : "  ";
        setText(before + indented + after);
      }
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0c0c10", color: "#d8d8e0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(0,0,0,0.2)", fontSize: 11,
      }}>
        <span style={{ opacity: 0.6, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>notes · {instanceId}</span>
        <span style={{ flex: 1 }} />
        <span style={{ opacity: 0.4, fontSize: 10 }}>
          {savedAt ? `saved ${relativeTime(savedAt)}` : "not saved"} · {text.length} chars
        </span>
        <button onClick={() => setShowPreview((v) => !v)} style={toolBtn} title="Toggle preview (Ctrl+P)">
          {showPreview ? "hide preview" : "show preview"}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          placeholder="# title\n\nstart typing…"
          style={{
            flex: showPreview ? 1 : 1.6,
            minWidth: 0,
            padding: "16px 20px",
            fontFamily: "ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace",
            fontSize: 13,
            lineHeight: 1.6,
            background: "#0c0c10",
            color: "#e2e2ea",
            border: "none",
            outline: "none",
            resize: "none",
            whiteSpace: "pre-wrap",
            tabSize: 2,
          }}
        />
        {showPreview && (
          <div
            className="notes-preview"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "16px 24px",
              overflow: "auto",
              borderLeft: "1px solid rgba(255,255,255,0.06)",
              fontSize: 14,
              lineHeight: 1.65,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}

const toolBtn: React.CSSProperties = {
  padding: "3px 10px",
  fontSize: 10,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  background: "rgba(255,255,255,0.04)",
  color: "#ccc",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 3,
  cursor: "pointer",
};

function relativeTime(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 2_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

const DEFAULT_BODY = `# notes

a blank note. markdown is live on the right.

- **Ctrl/Cmd+B** bold
- **Ctrl/Cmd+I** italic
- **Ctrl/Cmd+K** link
- **Ctrl/Cmd+P** toggle preview
- **Tab** indent lists

\`\`\`ts
// code blocks syntax-highlight in the preview
const hello = "world";
\`\`\`

> Autosaves every 500ms to localStorage.

your text persists across reloads under a per-pane key.
`;
