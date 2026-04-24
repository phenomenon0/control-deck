"use client";

import { useEffect, useState } from "react";

interface VoiceJob {
  id: string;
  voiceAssetId: string;
  jobType: string;
  status: string;
  engineId: string | null;
  providerId: string | null;
  modelId: string | null;
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}

interface JobQueueProps {
  /** Initial list from the server. Polling overrides this while any job is live. */
  jobs: VoiceJob[];
  /** Asset id to scope polling to; when omitted, polls all jobs. */
  voiceAssetId?: string;
  /** Poll interval in ms while at least one job is pending/running. */
  pollIntervalMs?: number;
  /** Job id to visually emphasise (e.g. after cross-pane nav). */
  highlightedJobId?: string;
  /** Called when the user wants to jump to the asset detail view (Library). */
  onInspectAsset?: (assetId: string) => void;
}

const LIVE_STATUSES = new Set(["queued", "running"]);

export function JobQueue({
  jobs: initial,
  voiceAssetId,
  pollIntervalMs = 2500,
  highlightedJobId,
  onInspectAsset,
}: JobQueueProps) {
  const [jobs, setJobs] = useState<VoiceJob[]>(initial);

  // Re-sync when the server-provided list changes (e.g., new job started).
  useEffect(() => {
    setJobs(initial);
  }, [initial]);

  useEffect(() => {
    const anyLive = jobs.some((j) => LIVE_STATUSES.has(j.status));
    if (!anyLive) return;

    let cancelled = false;
    const url = voiceAssetId
      ? `/api/voice/jobs?voiceAssetId=${encodeURIComponent(voiceAssetId)}`
      : `/api/voice/jobs`;

    const tick = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { jobs?: VoiceJob[] };
        if (cancelled) return;
        if (Array.isArray(data.jobs)) setJobs(data.jobs);
      } catch {
        // Network blip — keep polling.
      }
    };

    const handle = setInterval(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [jobs, voiceAssetId, pollIntervalMs]);

  const liveCount = jobs.filter((j) => LIVE_STATUSES.has(j.status)).length;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">Queue</div>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Voice jobs</h3>
        </div>
        {liveCount > 0 ? (
          <span className="pill--mono" aria-live="polite">
            {liveCount} live · auto-refresh
          </span>
        ) : null}
      </div>

      {jobs.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)]">No jobs yet.</div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const highlighted = job.id === highlightedJobId;
            const finished = job.status === "succeeded";
            return (
              <div
                key={job.id}
                className={`rounded-xl border p-3 ${
                  highlighted
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] bg-[var(--bg-primary)]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {job.jobType} · {job.engineId ?? job.providerId ?? "unknown-engine"}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-1">asset {job.voiceAssetId}</div>
                  </div>
                  <span className="pill--mono">{job.status}</span>
                </div>
                {job.error ? <div className="text-xs text-[var(--error)] mt-2">{job.error}</div> : null}
                <div className="text-xs text-[var(--text-muted)] mt-2">
                  created {new Date(job.createdAt).toLocaleString()}
                  {job.endedAt ? ` · ended ${new Date(job.endedAt).toLocaleString()}` : ""}
                </div>
                {finished && onInspectAsset ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      onClick={() => onInspectAsset(job.voiceAssetId)}
                    >
                      Open in Library →
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
