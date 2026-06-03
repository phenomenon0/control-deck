"use client";

/**
 * ThreadSidebar (v2) — the conversation list, with the full row-state set drawn
 * from polished chat sidebars (lobe-chat / ChatGPT / Cursor):
 *   default · hover (reveal actions) · active/selected (accent bar) · focus ·
 *   pressed · renaming (inline edit) · confirming-delete (inline confirm).
 *
 * Actions per row (rename ✎, delete 🗑) are revealed on hover OR keyboard focus
 * so they're discoverable without loading the thread. Delete is a two-step
 * inline confirm (never instant). Rename is inline-edit. Fully prop-driven; the
 * container wires onSelect/onNew/onRename/onDelete. Token + `cd-*` driven, so it
 * re-themes across every theme.
 */

import React, { useEffect, useRef, useState } from "react";

import { Button } from "./ui";

export interface ThreadItem {
  id: string;
  title: string;
  /** Preformatted meta, e.g. "2h ago". */
  meta?: string;
}

export interface ThreadSidebarProps {
  threads: ThreadItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  title?: string;
  emptyLabel?: string;
}

const META = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;
const TITLE = { fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" } as const;

export function ThreadSidebar({
  threads,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  title = "threads",
  emptyLabel = "No saved threads",
}: ThreadSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  const beginRename = (t: ThreadItem) => {
    setConfirmingId(null);
    setDraft(t.title);
    setRenamingId(t.id);
  };
  const commitRename = (id: string) => {
    const v = draft.trim();
    if (v && onRename) onRename(id, v);
    setRenamingId(null);
  };

  return (
    <aside className="cd-sidebar flex h-full flex-col bg-[var(--bg-secondary)]" aria-label="Threads">
      <header
        className="flex items-center justify-between border-b px-3 py-2.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="cd-eyebrow uppercase text-[var(--text-muted)]" style={META}>
          {title}
        </span>
        {onNew && (
          <Button variant="ghost" size="icon" onClick={onNew} aria-label="New thread" className="cd-sidebar-new">
            <PlusIcon />
          </Button>
        )}
      </header>

      <nav className="flex-1 overflow-y-auto py-1" aria-label="Thread list">
        {threads.length === 0 ? (
          <div className="px-3 py-6 text-[var(--text-muted)]" style={META}>
            {emptyLabel}
          </div>
        ) : (
          <ul className="flex flex-col">
            {threads.map((t) => {
              const active = t.id === activeId;
              const renaming = t.id === renamingId;
              const confirming = t.id === confirmingId;

              if (renaming) {
                return (
                  <li key={t.id} className="px-2 py-1">
                    <input
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitRename(t.id); }
                        if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                      }}
                      onBlur={() => commitRename(t.id)}
                      aria-label="Rename thread"
                      className="w-full rounded-[var(--radius-sm)] border bg-[var(--bg-tertiary)] px-2 py-1.5 text-[var(--text-primary)] outline-none"
                      style={{ ...TITLE, borderColor: "rgb(var(--accent-rgb))" }}
                    />
                  </li>
                );
              }

              return (
                <li key={t.id} className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(t.id)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onSelect(t.id);
                    }}
                    className="cd-thread group/thread flex cursor-pointer flex-col gap-0.5 px-3 py-2 pr-16 transition-all hover:bg-[var(--bg-tertiary)] focus-visible:bg-[var(--bg-tertiary)] focus-visible:outline-none active:bg-[var(--bg-elevated)]"
                  >
                    <span className="truncate text-[var(--text-primary)]" style={TITLE}>
                      {t.title}
                    </span>
                    {t.meta && (
                      <span className="text-[var(--text-muted)]" style={META}>
                        {t.meta}
                      </span>
                    )}
                  </div>

                  {/* Action cluster — reveals on hover/focus, or shows the delete confirm. */}
                  {confirming ? (
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                      <span className="text-[var(--text-muted)]" style={META}>
                        delete?
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { onDelete?.(t.id); setConfirmingId(null); }}
                        aria-label={`Confirm delete ${t.title}`}
                        style={{ color: "rgb(var(--accent-rgb))" }}
                      >
                        <CheckIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmingId(null)}
                        aria-label="Cancel delete"
                      >
                        <XIcon />
                      </Button>
                    </div>
                  ) : (
                    (onRename || onDelete) && (
                      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100">
                        {onRename && (
                          <Button variant="ghost" size="icon" onClick={() => beginRename(t)} aria-label={`Rename ${t.title}`}>
                            <PencilIcon />
                          </Button>
                        )}
                        {onDelete && (
                          <Button variant="ghost" size="icon" onClick={() => { setRenamingId(null); setConfirmingId(t.id); }} aria-label={`Delete ${t.title}`}>
                            <TrashIcon />
                          </Button>
                        )}
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
    </svg>
  );
}

export default ThreadSidebar;
