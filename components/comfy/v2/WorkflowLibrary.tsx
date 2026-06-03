"use client";

/**
 * WorkflowLibrary (comfy v2) — the saved-workflow list in the deck chrome.
 *
 * These are workflows persisted in the DECK (not ComfyUI's own files): each is
 * either a runnable `api_prompt` or a reference-only `ui_graph`, tagged by lane
 * (image/audio/3d/video). The container loads them from `/api/comfy/workflows`;
 * this leaf is pure presentation.
 *
 * Mirrors ThreadSidebar's row mechanics. Every action is opt-in:
 *   - `onSelect`  → rows are selectable (active row marked aria-current).
 *   - `onRun`     → a run button appears, but ONLY on runnable (`api_prompt`)
 *                   rows; `ui_graph` rows never offer a dead run.
 *   - `onInsertReference` → an "insert @workflow/<slug>" button appears.
 *
 * Token-driven; carries `cd-library` / `cd-workflow` / `cd-eyebrow` hooks.
 */

import React from "react";

export type WorkflowFormat = "ui_graph" | "api_prompt";
export type WorkflowLane = "image" | "audio" | "3d" | "video";

export interface WorkflowItem {
  id: string;
  slug: string;
  name: string;
  description?: string;
  format: WorkflowFormat;
  lane: WorkflowLane;
  tags?: string[];
  /** Preformatted trailing meta, e.g. "8.0 GB" or a comfy path. */
  meta?: string;
}

export interface WorkflowLibraryProps {
  workflows: WorkflowItem[];
  activeId?: string | null;
  loading?: boolean;
  title?: string;
  emptyLabel?: string;
  onSelect?: (id: string) => void;
  /** Enables the run button on runnable rows. */
  onRun?: (id: string) => void;
  /** Enables the insert-reference button. */
  onInsertReference?: (id: string) => void;
  /** Id of the row whose run is in flight (disables/marks that run button). */
  runningId?: string | null;
}

export function WorkflowLibrary({
  workflows,
  activeId = null,
  loading = false,
  title = "Workflows",
  emptyLabel = "No saved workflows yet.",
  onSelect,
  onRun,
  onInsertReference,
  runningId = null,
}: WorkflowLibraryProps) {
  return (
    <section className="cd-library flex h-full min-h-0 flex-col" aria-label="Workflow library">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <span
          className="cd-eyebrow text-[var(--text-secondary)]"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
        >
          {title}
        </span>
        <span className="text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
          {loading ? "loading…" : workflows.length || ""}
        </span>
      </header>

      {workflows.length === 0 ? (
        <p className="px-3 py-2 text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)" }}>
          {loading ? "" : emptyLabel}
        </p>
      ) : (
        <ul className="min-h-0 overflow-y-auto" role="list">
          {workflows.map((wf) => (
            <WorkflowRow
              key={wf.id}
              workflow={wf}
              active={wf.id === activeId}
              running={wf.id === runningId}
              onSelect={onSelect}
              onRun={onRun}
              onInsertReference={onInsertReference}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function WorkflowRow({
  workflow,
  active,
  running,
  onSelect,
  onRun,
  onInsertReference,
}: {
  workflow: WorkflowItem;
  active: boolean;
  running: boolean;
  onSelect?: (id: string) => void;
  onRun?: (id: string) => void;
  onInsertReference?: (id: string) => void;
}) {
  const runnable = workflow.format === "api_prompt";
  const showRun = Boolean(onRun) && runnable;

  return (
    <li
      className="cd-workflow group relative"
      aria-current={active ? "true" : undefined}
    >
      {/* active accent rail (CssCheck anchor) */}
      {active && (
        <span
          className="absolute inset-y-1 left-0 w-0.5 rounded-full"
          style={{ background: "rgb(var(--accent-rgb))" }}
          aria-hidden="true"
        />
      )}
      <div
        className="flex items-center gap-2 px-3 py-2 transition-colors"
        style={{ background: active ? "var(--bg-tertiary)" : "transparent" }}
      >
        <button
          type="button"
          onClick={onSelect ? () => onSelect(workflow.id) : undefined}
          disabled={!onSelect}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left disabled:cursor-default"
        >
          <span className="flex items-center gap-1.5 truncate">
            <span
              className="truncate text-[var(--text-primary)]"
              style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-strong, 600)" }}
            >
              {workflow.name}
            </span>
          </span>
          <span
            className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--text-muted)]"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
          >
            <span className="min-w-0 max-w-full truncate">@{workflow.slug}</span>
            <Badge>{workflow.lane}</Badge>
            <Badge tone={runnable ? "accent" : "muted"}>{runnable ? "runnable" : "reference"}</Badge>
            {workflow.meta && <span className="min-w-0 truncate">· {workflow.meta}</span>}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {onInsertReference && (
            <RowAction label={`Insert @workflow/${workflow.slug}`} onClick={() => onInsertReference(workflow.id)}>
              <ClipboardIcon />
            </RowAction>
          )}
          {showRun && (
            <RowAction
              label={running ? "Running…" : `Run ${workflow.name}`}
              onClick={() => onRun!(workflow.id)}
              disabled={running}
            >
              {running ? <SpinnerIcon /> : <PlayIcon />}
            </RowAction>
          )}
        </div>
      </div>
    </li>
  );
}

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" }) {
  return (
    <span
      className="rounded-[var(--radius-sm)] border px-1 py-px uppercase"
      style={{
        fontSize: "calc(var(--font-size-xs) - 1px)",
        letterSpacing: "var(--tracking-label, 0.02em)",
        borderColor: tone === "accent" ? "rgb(var(--accent-rgb))" : "var(--border-subtle)",
        color: tone === "accent" ? "rgb(var(--accent-rgb))" : "var(--text-muted)",
      }}
    >
      {children}
    </span>
  );
}

function RowAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

export default WorkflowLibrary;
