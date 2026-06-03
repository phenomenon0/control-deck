"use client";

/**
 * JobQueue (comfy v2) — the compact run-status list in the deck chrome.
 *
 * The scan-at-a-glance counterpart to OutputGallery: where the gallery shows
 * finished images, JobQueue shows what the ComfyUI queue is *doing* right now
 * (queued · running · done · error) as terse rows — status dot, workflow slug,
 * progress, elapsed. The container derives `jobs` from `/api/comfy/history`;
 * this leaf is pure presentation.
 *
 * Actions are opt-in: `onOpen` (jump to a job's outputs), `onCancel`
 * (queued/running), `onRetry` (error). Token-driven; carries `cd-jobqueue` /
 * `cd-job` hooks. The running progress bar is the CssCheck anchor.
 */

import React from "react";

import { Button, EmptyState, PanelHeader } from "@/components/chat/v2/ui";

export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobItem {
  /** ComfyUI promptId (display may slice it). */
  id: string;
  status: JobStatus;
  workflow?: string;
  /** 0..1 while running. */
  progress?: number;
  /** Status string / "done" / "pending". */
  statusLabel?: string;
  /** Preformatted elapsed, e.g. "4.2s". */
  elapsed?: string;
  error?: string;
}

export interface JobQueueProps {
  jobs: JobItem[];
  title?: string;
  emptyLabel?: string;
  loading?: boolean;
  onOpen?: (id: string) => void;
  /** Cancel a queued/running job. */
  onCancel?: (id: string) => void;
  /** Retry an errored job. */
  onRetry?: (id: string) => void;
}

const DOT: Record<JobStatus, string> = {
  queued: "var(--text-muted)",
  running: "rgb(var(--accent-rgb))",
  done: "#3fb950",
  error: "#ff6b6b",
};

export function JobQueue({
  jobs,
  title = "Queue",
  emptyLabel = "No recent jobs.",
  loading = false,
  onOpen,
  onCancel,
  onRetry,
}: JobQueueProps) {
  return (
    <section className="cd-jobqueue flex h-full min-h-0 flex-col" aria-label="Job queue">
      <PanelHeader eyebrow={title} count={loading ? "loading…" : jobs.length || ""} />

      {jobs.length === 0 ? (
        loading ? null : <EmptyState variant="inline" description={emptyLabel} />
      ) : (
        <ul className="min-h-0 overflow-y-auto" role="list">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} onOpen={onOpen} onCancel={onCancel} onRetry={onRetry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function JobRow({
  job,
  onOpen,
  onCancel,
  onRetry,
}: {
  job: JobItem;
  onOpen?: (id: string) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
}) {
  const active = job.status === "queued" || job.status === "running";
  const pct = Math.round(Math.min(1, Math.max(0, job.progress ?? 0)) * 100);
  const label = job.statusLabel ?? job.status;

  return (
    <li className="cd-job group flex items-center gap-2 px-3 py-2" aria-label={`Job ${job.id} ${label}`}>
      <span
        className={`mt-1 inline-block h-2 w-2 shrink-0 self-start rounded-full${job.status === "running" ? " animate-pulse" : ""}`}
        style={{ background: DOT[job.status] }}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={onOpen ? () => onOpen(job.id) : undefined}
        disabled={!onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left disabled:cursor-default"
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span
            className="truncate text-[var(--text-primary)]"
            style={{ fontSize: "var(--font-size-sm)" }}
          >
            {job.workflow ?? job.id.slice(0, 10)}
          </span>
          <span
            className="shrink-0 text-[var(--text-muted)]"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
          >
            {job.status === "error" ? "failed" : label}
            {job.elapsed ? ` · ${job.elapsed}` : ""}
          </span>
        </span>

        {job.status === "running" && (
          <span className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-tertiary)" }}>
            <span
              className="block h-full rounded-full transition-[width] duration-300"
              style={{ width: `${pct}%`, background: "rgb(var(--accent-rgb))" }}
            />
          </span>
        )}
        {job.status === "error" && job.error && (
          <span className="truncate text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-xs)" }}>
            {job.error}
          </span>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-0.5 self-start opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {onRetry && job.status === "error" && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Retry job ${job.id}`}
            title={`Retry job ${job.id}`}
            onClick={() => onRetry(job.id)}
          >
            <RetryIcon />
          </Button>
        )}
        {onCancel && active && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Cancel job ${job.id}`}
            title={`Cancel job ${job.id}`}
            onClick={() => onCancel(job.id)}
          >
            <CancelIcon />
          </Button>
        )}
      </div>
    </li>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default JobQueue;
