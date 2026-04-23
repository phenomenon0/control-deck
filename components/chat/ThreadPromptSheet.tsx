"use client";

/**
 * Per-thread system-prompt editor. Opened from the right rail's
 * "Thread prompt" row. Writes to /api/threads/[id]/system-prompt so
 * server-side route resolution can consult it before falling back to
 * the global DeckPrefs.systemPrompt.
 *
 * States:
 *   - inherits: empty/null — thread uses the global default
 *   - custom: a non-empty string that overrides the global
 *
 * The preset dropdown is the same library that Settings uses, so "this
 * thread is coding" is one click. Clearing reverts to inherits.
 */

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { PROMPT_LIBRARY, findPreset, matchPreset } from "@/lib/llm/promptLibrary";

interface ThreadPromptSheetProps {
  threadId: string;
  onClose: () => void;
}

export function ThreadPromptSheet({ threadId, onClose }: ThreadPromptSheetProps) {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/threads/${threadId}/system-prompt`, { cache: "no-store" }).catch(() => null);
      if (!cancelled && r?.ok) {
        const d = (await r.json()) as { systemPrompt: string | null };
        setValue(d.systemPrompt ?? "");
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/threads/${threadId}/system-prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value.trim() ? value : null }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }, [threadId, value, onClose]);

  const clear = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/threads/${threadId}/system-prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: null }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }, [threadId, onClose]);

  const activePresetId = matchPreset(value)?.id ?? "__custom";

  return (
    <div className="thread-prompt-sheet-scrim" role="dialog" aria-modal="true" aria-label="Thread system prompt">
      <div className="thread-prompt-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="thread-prompt-sheet-head">
          <div>
            <strong>Thread system prompt</strong>
            <span>Overrides the global default for this thread only</span>
          </div>
          <button type="button" onClick={onClose} className="thread-prompt-close" aria-label="Close">
            <X size={14} />
          </button>
        </header>

        {!loaded ? (
          <p className="thread-prompt-note">Loading…</p>
        ) : (
          <>
            <div className="thread-prompt-preset-row">
              <label>Preset</label>
              <select
                value={activePresetId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__custom") return;
                  const preset = findPreset(v);
                  if (preset) setValue(preset.prompt);
                }}
              >
                {PROMPT_LIBRARY.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.description}
                  </option>
                ))}
                <option value="__custom">Custom (edited)</option>
              </select>
            </div>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={10}
              spellCheck={false}
              placeholder="Leave blank to inherit the global system prompt. Model-family language anchors are added automatically."
            />
            <div className="thread-prompt-actions">
              <span className="thread-prompt-meta">
                {value.trim() ? `${value.length} chars · overrides global` : "inherits global"}
              </span>
              <div className="thread-prompt-buttons">
                <button type="button" onClick={clear} disabled={saving || !value.trim()}>
                  Clear override
                </button>
                <button type="button" onClick={save} disabled={saving} className="thread-prompt-save">
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
