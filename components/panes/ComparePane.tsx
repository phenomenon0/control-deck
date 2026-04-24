"use client";

/**
 * ComparePane — side-by-side AG-UI timeline viewer for up to 4 threads.
 *
 * Supports chat thread UUIDs and terminal:<sessionId> namespaced IDs.
 * Column selection is persisted to localStorage under "deck:compare-columns".
 */

import { useEffect, useState, useCallback } from "react";
import { X, Plus, GitCompare } from "lucide-react";
import { ChatTimeline } from "@/components/chat/ChatTimeline";
import { useThreadStream } from "@/lib/hooks/useThreadStream";

const MAX_COLUMNS = 4;
const STORAGE_KEY = "deck:compare-columns";

// ─── Data types ────────────────────────────────────────────────────────────

interface ThreadOption {
  id: string;
  label: string;
  kind: "chat" | "terminal";
}

// ─── Storage helpers ───────────────────────────────────────────────────────

function loadStoredColumns(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed as unknown[])
        .filter((v): v is string => typeof v === "string")
        .slice(0, MAX_COLUMNS);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveColumns(cols: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cols.slice(0, MAX_COLUMNS)));
  } catch {
    // ignore
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface ColumnProps {
  threadId: string;
  index: number;
  onRemove: (idx: number) => void;
}

function CompareColumn({ threadId, index, onRemove }: ColumnProps) {
  const { state, isConnected } = useThreadStream(threadId);
  const isStreaming = state.runState.phase === "streaming" || state.runState.phase === "executing";

  const label = threadId.startsWith("terminal:")
    ? `Terminal · ${threadId.slice(9, 17)}…`
    : `Thread · ${threadId.slice(0, 8)}…`;

  return (
    <div className="compare-column">
      <div className="compare-column-header">
        <div className="compare-column-title">
          <span
            className={`compare-conn-dot ${isConnected ? "compare-conn-dot--live" : ""}`}
            title={isConnected ? "connected" : "connecting…"}
          />
          <span className="compare-column-label" title={threadId}>{label}</span>
        </div>
        <button
          className="compare-column-close"
          onClick={() => onRemove(index)}
          aria-label={`Remove column ${index + 1}`}
        >
          <X size={12} />
        </button>
      </div>

      <div className="compare-column-body">
        <ChatTimeline
          segments={state.segments}
          isStreaming={isStreaming}
          emptyState={
            <div className="compare-empty">
              Waiting for events on<br />
              <code className="compare-empty-id">{threadId}</code>
            </div>
          }
        />
      </div>
    </div>
  );
}

// ─── Thread selector dropdown ──────────────────────────────────────────────

interface SelectorProps {
  options: ThreadOption[];
  onSelect: (id: string) => void;
}

function ThreadSelector({ options, onSelect }: SelectorProps) {
  const [custom, setCustom] = useState("");
  const [open, setOpen] = useState(false);

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  const handleCustomSubmit = () => {
    const id = custom.trim();
    if (id) {
      onSelect(id);
      setCustom("");
      setOpen(false);
    }
  };

  return (
    <div className="compare-selector">
      <button
        className="compare-selector-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add column"
      >
        <Plus size={14} />
        Add column
      </button>

      {open && (
        <div className="compare-selector-dropdown">
          {options.length > 0 && (
            <>
              <div className="compare-selector-section">Recent threads</div>
              {options
                .filter((o) => o.kind === "chat")
                .map((o) => (
                  <button
                    key={o.id}
                    className="compare-selector-item"
                    onClick={() => handleSelect(o.id)}
                  >
                    <span className="compare-selector-kind">chat</span>
                    {o.label}
                  </button>
                ))}

              {options.some((o) => o.kind === "terminal") && (
                <>
                  <div className="compare-selector-section">Terminal sessions</div>
                  {options
                    .filter((o) => o.kind === "terminal")
                    .map((o) => (
                      <button
                        key={o.id}
                        className="compare-selector-item"
                        onClick={() => handleSelect(o.id)}
                      >
                        <span className="compare-selector-kind">term</span>
                        {o.label}
                      </button>
                    ))}
                </>
              )}
              <div className="compare-selector-divider" />
            </>
          )}

          <div className="compare-selector-section">Custom threadId</div>
          <div className="compare-selector-custom">
            <input
              className="compare-selector-input"
              placeholder="terminal:abc123 or UUID"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
                if (e.key === "Escape") setOpen(false);
              }}
              autoFocus
            />
            <button
              className="compare-selector-go"
              onClick={handleCustomSubmit}
              disabled={!custom.trim()}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main pane ─────────────────────────────────────────────────────────────

interface AguiThread {
  id: string;
  title: string | null;
}

interface TerminalSession {
  id: string;
  name?: string;
  profile?: string;
}

export function ComparePane() {
  // Lazy initializer — runs once on mount (client-only, safe because page is
  // loaded with `ssr: false`).
  const [columns, setColumns] = useState<string[]>(loadStoredColumns);
  const [options, setOptions] = useState<ThreadOption[]>([]);

  // Persist columns whenever they change
  useEffect(() => {
    saveColumns(columns);
  }, [columns]);

  // Load thread & session options
  useEffect(() => {
    const opts: ThreadOption[] = [];

    const loadAll = async () => {
      // Chat threads from /api/agui/threads
      try {
        const res = await fetch("/api/agui/threads?limit=30");
        if (res.ok) {
          const data = (await res.json()) as { threads: AguiThread[] };
          for (const t of data.threads ?? []) {
            // terminal: prefixed threads come from the terminal bridge
            if (t.id.startsWith("terminal:")) {
              opts.push({
                id: t.id,
                label: t.title ?? t.id.slice(0, 24),
                kind: "terminal",
              });
            } else {
              opts.push({
                id: t.id,
                label: t.title ?? `Thread ${t.id.slice(0, 8)}`,
                kind: "chat",
              });
            }
          }
        }
      } catch {
        // non-fatal
      }

      // Also try /api/terminal/sessions for live terminal sessions not yet in the agui db
      try {
        const res = await fetch("/api/terminal/sessions");
        if (res.ok) {
          const data = (await res.json()) as { sessions: TerminalSession[] };
          for (const s of data.sessions ?? []) {
            const tid = `terminal:${s.id}`;
            if (!opts.find((o) => o.id === tid)) {
              opts.push({
                id: tid,
                label: s.name ?? s.profile ?? `session ${s.id.slice(0, 8)}`,
                kind: "terminal",
              });
            }
          }
        }
      } catch {
        // terminal service may not be running — non-fatal
      }

      setOptions(opts);
    };

    void loadAll();
  }, []);

  const addColumn = useCallback((id: string) => {
    setColumns((prev) => {
      if (prev.includes(id) || prev.length >= MAX_COLUMNS) return prev;
      return [...prev, id];
    });
  }, []);

  const removeColumn = useCallback((idx: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Filter options that aren't already in columns
  const availableOptions = options.filter((o) => !columns.includes(o.id));

  return (
    <div className="compare-pane">
      <div className="compare-toolbar">
        <div className="compare-toolbar-left">
          <GitCompare size={14} />
          <span className="compare-toolbar-title">Compare</span>
          <span className="compare-toolbar-count">
            {columns.length} / {MAX_COLUMNS} columns
          </span>
        </div>

        {columns.length < MAX_COLUMNS && (
          <ThreadSelector options={availableOptions} onSelect={addColumn} />
        )}
      </div>

      {columns.length === 0 ? (
        <div className="compare-splash">
          <GitCompare size={32} strokeWidth={1} />
          <p className="compare-splash-heading">No columns yet</p>
          <p className="compare-splash-sub">
            Add up to {MAX_COLUMNS} thread columns to watch them side-by-side.
          </p>
          <ThreadSelector options={availableOptions} onSelect={addColumn} />
        </div>
      ) : (
        <div
          className="compare-grid"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map((tid, idx) => (
            <CompareColumn
              key={`${tid}-${idx}`}
              threadId={tid}
              index={idx}
              onRemove={removeColumn}
            />
          ))}
        </div>
      )}
    </div>
  );
}
