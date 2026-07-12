"use client";

import { AlertTriangle, Copy, X } from "lucide-react";

import { StartComfyButton, useComfyStart } from "./recovery";
import type { ImageJob } from "./useImageJobs";

/** The running/done/error jobs, drawn as design-lab progress channels — not boxes. */
export function JobStrip({
  jobs,
  onDismiss,
}: {
  jobs: ImageJob[];
  onDismiss: (id: string) => void;
}) {
  if (jobs.length === 0) return null;

  return (
    <div className="job-strip">
      {jobs.slice(-6).reverse().map((job) =>
        job.status === "error" ? (
          <RecoveryChip key={job.id} job={job} onDismiss={onDismiss} />
        ) : (
          <div className="job-line" key={job.id}>
            <span className="job-line__label">{job.label}</span>
            <span className="progress">
              <span
                className={`progress__fill ${job.status === "running" ? "is-indeterminate" : "is-done"}`}
              />
            </span>
            <span className="job-state">{job.status === "running" ? "working…" : "done"}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDismiss(job.id)}
              aria-label="dismiss job"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        ),
      )}
    </div>
  );
}

function RecoveryChip({
  job,
  onDismiss,
}: {
  job: ImageJob;
  onDismiss: (id: string) => void;
}) {
  const { startError } = useComfyStart();
  const recoveryText = (job.recovery ?? []).join("\n");
  /* the executor tags a stopped rig with error_code "comfy_offline" and a
     recovery line naming start-comfy.sh — the real fix is starting it, so offer
     the one-click action instead of a shell command the user must run by hand.
     (the BridgeClientError catch path leaves job.result empty, hence the regex.) */
  const comfyOffline =
    job.result?.error_code === "comfy_offline" || /start-comfy\.sh/i.test(recoveryText);
  const downloadCommand = commandFromRecovery(job.recovery);

  return (
    <div className="danger-chip">
      <details>
        <summary>
          <AlertTriangle size={13} aria-hidden="true" />
          <span>{job.label}: {job.error ?? "failed"}</span>
        </summary>
        {job.recovery?.length ? (
          <ul>
            {job.recovery.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {downloadCommand ? (
          <button
            type="button"
            className="word-act"
            onClick={() => void navigator.clipboard?.writeText(downloadCommand)}
          >
            <Copy size={12} aria-hidden="true" />
            copy command
          </button>
        ) : null}
      </details>
      <div className="chip-acts">
        {comfyOffline ? <StartComfyButton className="word-act" /> : null}
        <button type="button" className="word-act" onClick={() => onDismiss(job.id)}>
          dismiss
        </button>
      </div>
      {comfyOffline && startError ? (
        <p className="rig-hint rig-hint--danger chip-start-err">{startError}</p>
      ) : null}
    </div>
  );
}

function commandFromRecovery(recovery: string[] | undefined): string | null {
  if (!recovery) return null;
  const joined = recovery.join("\n");
  const match = joined.match(/bash scripts\/download-image-models\.sh [A-Za-z0-9._-]+/);
  return match?.[0] ?? null;
}
