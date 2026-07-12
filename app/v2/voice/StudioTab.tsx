"use client";

import "./studio-v2.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useVoiceLibrary, type VoiceAssetSummary } from "@/lib/hooks/useVoiceLibrary";
import { useLabStore, type LaunchConfigKey, type TtsBackend } from "@/lib/voice-lab/store";

import { CloneModal } from "./CloneModal";
import { Ico, PLAY, STOP, ARROW } from "./icons";

const PLUS = '<path d="M12 5v14M5 12h14"/>';
const XMARK = '<path d="M18 6L6 18M6 6l12 12"/>';

interface VoiceJob {
  id: string;
  voiceAssetId: string;
  jobType: string;
  status: string;
  engineId: string | null;
  providerId: string | null;
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}

interface Preview {
  id: string;
  promptText: string;
  ratingSimilarity: number | null;
  artifact: { id: string; name: string; url: string; createdAt: string } | null;
}

/** A saved local Qwen3 reference clip (from /api/voice/refs). */
interface LocalRef {
  name: string;
  path: string;
  refText: string;
  size: number;
  createdAt: string;
}

const LIVE_STATUSES = new Set(["queued", "running"]);
const JOBS_POLL_MS = 2500;
const DAY_MS = 86_400_000;
const STALL_MS = 600_000; // a job "queued" longer than 10 min is stalled, not queued
const MAX_VISIBLE_JOBS = 5;

/** Which per-engine LaunchConfig voice field the active TTS backend writes to.
 *  chatTTS / facebookMMS have no speaker-preset slot. */
const VOICE_FIELD: Partial<Record<TtsBackend, LaunchConfigKey>> = {
  kokoro: "kokoro_voice",
  qwen3: "qwen3_tts_speaker",
  pocket: "pocket_tts_voice",
};

function jobTime(job: VoiceJob): number {
  return Date.parse(job.endedAt ?? job.createdAt) || 0;
}

/** A queued job older than 10 min never got picked up — show it as stalled. */
function effectiveStatus(job: VoiceJob): string {
  if (job.status === "queued" && Date.now() - (Date.parse(job.createdAt) || 0) > STALL_MS) {
    return "stalled";
  }
  return job.status;
}

export function StudioTab() {
  const store = useLabStore();
  const library = useVoiceLibrary({ includeDrafts: true });

  const [refs, setRefs] = useState<LocalRef[]>([]);
  const [refsError, setRefsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<VoiceJob[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [hiddenJobs, setHiddenJobs] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [staged, setStaged] = useState<string | null>(null);

  // Single shared <audio>; the currently playing key is asset.id or "ref:<path>".
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  // Which knob field the active pipeline engine uses for its voice.
  const activeTts = store.knobs.tts;
  const voiceField = VOICE_FIELD[activeTts];
  const activeVoiceValue = voiceField ? String(store.knobs[voiceField] ?? "") : null;
  const activeRefAudio = String(store.knobs.qwen3_tts_ref_audio ?? "");

  const loadRefs = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/refs", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load reference clips");
      setRefs(Array.isArray(data.refs) ? data.refs : []);
      setRefsError(null);
    } catch (err) {
      setRefsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/jobs", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load jobs");
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setJobsError(null);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadRefs();
    void loadJobs();
  }, [loadRefs, loadJobs]);

  // Poll while any job is non-terminal.
  useEffect(() => {
    if (!jobs.some((j) => LIVE_STATUSES.has(j.status))) return;
    const id = window.setInterval(() => void loadJobs(), JOBS_POLL_MS);
    return () => window.clearInterval(id);
  }, [jobs, loadJobs]);

  // Auto-dismiss the quiet "staged" confirmation.
  useEffect(() => {
    if (!staged) return;
    const id = window.setTimeout(() => setStaged(null), 4200);
    return () => window.clearTimeout(id);
  }, [staged]);

  const stopAudio = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setPlayingKey(null);
  }, []);

  const playUrl = useCallback(
    async (key: string, url: string) => {
      setPlayError(null);
      if (playingKey === key) {
        stopAudio();
        return;
      }
      const el = audioRef.current;
      if (!el) return;
      try {
        el.src = url;
        await el.play();
        setPlayingKey(key);
      } catch (err) {
        setPlayError(err instanceof Error ? err.message : String(err));
      }
    },
    [playingKey, stopAudio],
  );

  // Play the latest preview attached to a library asset.
  const playAsset = useCallback(
    async (voiceAssetId: string) => {
      setPlayError(null);
      if (playingKey === voiceAssetId) {
        stopAudio();
        return;
      }
      try {
        const res = await fetch(`/api/voice/previews?voiceAssetId=${encodeURIComponent(voiceAssetId)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load previews");
        const previews: Preview[] = Array.isArray(data.previews) ? data.previews : [];
        const withAudio = previews.filter((p) => p.artifact?.url);
        if (withAudio.length === 0) {
          setPlayError("No preview audio yet for this voice — clone or generate one first.");
          return;
        }
        withAudio.sort(
          (a, b) => new Date(b.artifact!.createdAt).getTime() - new Date(a.artifact!.createdAt).getTime(),
        );
        await playUrl(voiceAssetId, withAudio[0].artifact!.url);
      } catch (err) {
        setPlayError(err instanceof Error ? err.message : String(err));
      }
    },
    [playingKey, stopAudio, playUrl],
  );

  /** Stage a saved local ref into the pipeline: the two Qwen3 knobs + tts=qwen3. */
  const stageLocalRef = useCallback(
    (ref: LocalRef) => {
      store.setKnob("qwen3_tts_ref_audio", ref.path);
      store.setKnob("qwen3_tts_ref_text", ref.refText);
      store.setKnob("tts", "qwen3");
      setUseError(null);
      setStaged("staged — validate & apply in Pipeline to hear it");
    },
    [store],
  );

  function useInPipeline(asset: VoiceAssetSummary) {
    if (!voiceField) {
      setUseError(
        `Active pipeline engine "${activeTts}" has no voice slot — switch to Kokoro, Qwen3 or Pocket in the Pipeline tab to assign a saved voice.`,
      );
      return;
    }
    store.setKnob(voiceField, asset.name);
    setUseError(null);
  }

  const saveToLibrary = useCallback(
    async (voiceAssetId: string) => {
      try {
        const res = await fetch(`/api/voice/library/${voiceAssetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "publish" }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to save to library");
        }
        await library.refreshAssets();
      } catch (err) {
        setUseError(err instanceof Error ? err.message : String(err));
      }
    },
    [library],
  );

  const isActive = useCallback(
    (asset: VoiceAssetSummary) => voiceField != null && activeVoiceValue === asset.name,
    [voiceField, activeVoiceValue],
  );

  const refreshAfterClone = useCallback(async () => {
    await Promise.all([library.refreshAssets(), loadJobs(), loadRefs()]);
  }, [library, loadJobs, loadRefs]);

  const assetName = useCallback(
    (id: string) => library.assets.find((a) => a.id === id)?.name ?? id,
    [library.assets],
  );

  // Jobs: only running or terminal-within-24h, newest first, capped at 5.
  // Everything else (months-old zombies, overflow) folds into `history (N)`.
  const { visibleJobs, historyCount, anyLive } = useMemo(() => {
    const shown = jobs.filter((j) => !hiddenJobs.has(j.id));
    const eligible = shown.filter((j) => j.status === "running" || Date.now() - jobTime(j) < DAY_MS);
    eligible.sort((a, b) => jobTime(b) - jobTime(a));
    const visible = eligible.slice(0, MAX_VISIBLE_JOBS);
    return {
      visibleJobs: visible,
      historyCount: shown.length - visible.length,
      anyLive: shown.filter((j) => LIVE_STATUSES.has(j.status)).length,
    };
  }, [jobs, hiddenJobs]);

  const historyJobs = useMemo(() => {
    if (!showHistory) return [];
    const shown = jobs.filter((j) => !hiddenJobs.has(j.id));
    shown.sort((a, b) => jobTime(b) - jobTime(a));
    return shown.slice(MAX_VISIBLE_JOBS);
  }, [showHistory, jobs, hiddenJobs]);

  const jobsToRender = showHistory ? [...visibleJobs, ...historyJobs] : visibleJobs;

  const hideJob = useCallback((id: string) => {
    setHiddenJobs((prev) => new Set(prev).add(id));
  }, []);

  const voiceCount = refs.length + library.assets.length;

  return (
    <div className="studio">
      {/* head — just a count + the clone action, right-aligned. No hero. */}
      <div className="studio-head">
        <span className="count">
          {library.loading && library.assets.length === 0 ? "loading…" : `${voiceCount} ${voiceCount === 1 ? "voice" : "voices"}`}
        </span>
        <button type="button" className="btn btn--primary" onClick={() => setCloneOpen(true)}>
          <Ico d={PLUS} /> clone_voice
        </button>
      </div>

      {library.error ? <div className="err-chip">{library.error}</div> : null}
      {refsError ? <div className="err-chip">refs — {refsError}</div> : null}
      {useError ? <div className="err-chip">{useError}</div> : null}
      {playError ? <div className="err-chip">{playError}</div> : null}

      {/* Voice grid — local refs first (local-first), then saved cloud voices */}
      {library.loading && library.assets.length === 0 && refs.length === 0 ? (
        <div className="empty-block">Loading voices…</div>
      ) : voiceCount === 0 ? (
        <div className="card empty-block">No voices yet — clone one from a reference clip to get started.</div>
      ) : (
        <div className="studio-grid">
          {refs.map((ref) => {
            const key = `ref:${ref.path}`;
            const playing = playingKey === key;
            const active = activeRefAudio === ref.path;
            return (
              <div key={ref.path} className={`card studio-card${active ? " is-active" : ""}`}>
                <div className="studio-card__top">
                  <div className="studio-card__name">{ref.name}</div>
                  {active ? <span className="studio-active-tag">in use</span> : null}
                </div>
                <div className="tagrow">
                  <span className="tag tag--positive">local ref</span>
                  <span className="tag">qwen3</span>
                </div>
                {ref.refText ? <div className="studio-card__desc">{ref.refText}</div> : null}
                <div className="studio-card__acts">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void playUrl(key, `/api/voice/refs?path=${encodeURIComponent(ref.path)}`)}
                    aria-label={playing ? "stop" : "play reference clip"}
                  >
                    <Ico d={playing ? STOP : PLAY} />
                    {playing ? "stop" : "▶ play"}
                  </button>
                  <button
                    type="button"
                    className={`btn btn--sm${active ? "" : " btn--primary"}`}
                    onClick={() => stageLocalRef(ref)}
                    disabled={active}
                  >
                    {active ? "assigned" : "use_in_pipeline"}
                  </button>
                </div>
              </div>
            );
          })}

          {library.assets.map((asset) => {
            const active = isActive(asset);
            const playing = playingKey === asset.id;
            const engineTag = asset.engineId ?? asset.providerId;
            return (
              <div key={asset.id} className={`card studio-card${active ? " is-active" : ""}`}>
                <div className="studio-card__top">
                  <div className="studio-card__name">{asset.name}</div>
                  {active ? <span className="studio-active-tag">in use</span> : null}
                </div>
                <div className="tagrow">
                  <span className={`tag${asset.status === "approved" ? " tag--positive" : ""}`}>
                    {asset.status}
                  </span>
                  {engineTag ? <span className="tag">{engineTag}</span> : null}
                  {asset.language ? <span className="tag">{asset.language}</span> : null}
                </div>
                {asset.description ? <div className="studio-card__desc">{asset.description}</div> : null}
                <div className="studio-card__acts">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void playAsset(asset.id)}
                    aria-label={playing ? "stop" : "play voice"}
                  >
                    <Ico d={playing ? STOP : PLAY} />
                    {playing ? "stop" : "▶ play"}
                  </button>
                  <button
                    type="button"
                    className={`btn btn--sm${active ? "" : " btn--primary"}`}
                    onClick={() => useInPipeline(asset)}
                    disabled={active}
                  >
                    {active ? "assigned" : "use_in_pipeline"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <audio ref={audioRef} className="sr-only" onEnded={() => setPlayingKey(null)} preload="none" />

      {/* Jobs strip — recent activity only */}
      <div className="group">
        <div className="glabel">
          Clone jobs{anyLive > 0 ? ` · ${anyLive} live · auto-refresh` : ""}
        </div>
        {jobsError ? <div className="err-chip">{jobsError}</div> : null}
        {jobsToRender.length === 0 ? (
          <div className="card empty-block">No recent clone jobs.</div>
        ) : (
          <div className="studio-jobs">
            {jobsToRender.map((job) => {
              const eff = effectiveStatus(job);
              const done = job.status === "succeeded";
              const expanded = expandedJob === job.id;
              const tone =
                job.status === "failed"
                  ? " tag--danger"
                  : done
                    ? " tag--positive"
                    : eff === "stalled"
                      ? " tag--caution"
                      : LIVE_STATUSES.has(job.status)
                        ? " tag--caution"
                        : "";
              return (
                <div key={job.id} className="card card--well studio-job">
                  <div className="studio-job__row">
                    <div className="studio-job__lede">
                      <div className="studio-job__title">
                        {job.jobType} · {assetName(job.voiceAssetId)}
                      </div>
                      <div className="studio-job__meta">
                        {job.engineId ?? job.providerId ?? "engine?"} ·{" "}
                        {new Date(job.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span className={`tag tag--dot${tone}`}>
                      <span className="tdot" />
                      {eff}
                    </span>
                    <button
                      type="button"
                      className="btn btn--icon btn--sm studio-job__x"
                      onClick={() => hideJob(job.id)}
                      title="dismiss"
                      aria-label="dismiss job"
                    >
                      <Ico d={XMARK} />
                    </button>
                  </div>
                  {job.error ? <div className="studio-job__err">{job.error}</div> : null}
                  {done ? (
                    <div className="studio-job__previews">
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => setExpandedJob(expanded ? null : job.id)}
                      >
                        {expanded ? "hide takes" : "review takes"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => void saveToLibrary(job.voiceAssetId)}
                      >
                        save to library
                      </button>
                    </div>
                  ) : null}
                  {done && expanded ? (
                    <JobTakes
                      jobId={job.id}
                      playingKey={playingKey}
                      onPlay={playUrl}
                      onRated={refreshAfterClone}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {historyCount > 0 ? (
          <button
            type="button"
            className="studio-history-fold"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
          >
            {showHistory ? "hide history" : `history (${historyCount})`}
          </button>
        ) : null}
      </div>

      {staged ? (
        <div className="studio-toast" role="status">
          <Ico d={ARROW} cls="ic" />
          {staged}
        </div>
      ) : null}

      {cloneOpen ? (
        <CloneModal onDone={refreshAfterClone} onClose={() => setCloneOpen(false)} onStaged={(m) => setStaged(m)} />
      ) : null}
    </div>
  );
}

/** Compact take review for a finished job: play each take, and pick a preferred
 *  one (bumps its similarity rating — copied from PreviewComparator). */
function JobTakes({
  jobId,
  playingKey,
  onPlay,
  onRated,
}: {
  jobId: string;
  playingKey: string | null;
  onPlay: (key: string, url: string) => void | Promise<void>;
  onRated: () => void | Promise<void>;
}) {
  const [takes, setTakes] = useState<Preview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/voice/previews?jobId=${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load takes");
        if (!cancelled) setTakes(Array.isArray(data.previews) ? data.previews : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function prefer(take: Preview) {
    setPicked(take.id);
    try {
      const next = Math.min(5, (take.ratingSimilarity ?? 3) + 1);
      await fetch(`/api/voice/previews/${take.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ similarity: next }),
      });
      await onRated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error) return <div className="studio-job__err">{error}</div>;
  if (!takes) return <div className="studio-job__meta">Loading takes…</div>;

  const withAudio = takes.filter((t) => t.artifact?.url);
  if (withAudio.length === 0) return <div className="studio-job__meta">No audio takes attached.</div>;
  const showPick = withAudio.length >= 2;

  return (
    <div className="studio-job__previews" style={{ flexDirection: "column", alignItems: "stretch" }}>
      {withAudio.map((take, i) => {
        const playing = playingKey === take.id;
        return (
          <div key={take.id} className="studio-abchip" style={{ justifyContent: "space-between", width: "100%" }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => void onPlay(take.id, take.artifact!.url)}
            >
              <Ico d={playing ? STOP : PLAY} />
              {showPick ? `take ${String.fromCharCode(65 + i)}` : "▶ play"}
            </button>
            {showPick ? (
              <button
                type="button"
                className={`btn btn--sm${picked === take.id ? " btn--primary" : ""}`}
                onClick={() => void prefer(take)}
              >
                {picked === take.id ? "preferred" : "prefer"}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
