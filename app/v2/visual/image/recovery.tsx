"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Copy, LoaderCircle } from "lucide-react";

/* =============================================================================
   Shared recovery affordances for the /v2/visual image surface.
   -----------------------------------------------------------------------------
   The one-click ComfyUI start flow used to live inline in the masthead. It is
   lifted here into a context so every offline surface — masthead hint, ComfyUI
   embed panel, the composer tabs, and a failed job's RecoveryChip — shares one
   `starting` state (cannot double-spawn the rig) and one start action.
   ============================================================================= */

/* The tooltip that names the actual start script the button spawns. */
const START_SCRIPT = "bash ~/ai/ComfyUI/start-comfy.sh";

interface ComfyStartValue {
  starting: boolean;
  startError: string | null;
  startComfy: () => Promise<void>;
  clearStartError: () => void;
}

const ComfyStartContext = createContext<ComfyStartValue | null>(null);

export function ComfyStartProvider({ children }: { children: ReactNode }) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startingRef = useRef(false);

  /* spawn start-comfy.sh, then poll /api/comfy/free until online */
  const startComfy = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    try {
      await fetch("/api/comfy/start", { method: "POST", cache: "no-store" });
    } catch {
      /* the script is spawned detached — keep polling regardless of this response */
    }
    const deadline = Date.now() + 120_000;
    const poll = async (): Promise<void> => {
      try {
        const r = await fetch("/api/comfy/free", { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { comfyui?: string };
          if (d.comfyui === "online") {
            startingRef.current = false;
            setStarting(false);
            /* nudge every poller on the surface (masthead /free + tabs /models) */
            window.dispatchEvent(new Event("comfy:online"));
            return;
          }
        }
      } catch {
        /* still coming up — keep polling */
      }
      if (Date.now() >= deadline) {
        startingRef.current = false;
        setStarting(false);
        setStartError(
          "comfy did not come online in 2 minutes — check the terminal running start-comfy.sh, then press start_comfy to retry",
        );
        return;
      }
      window.setTimeout(() => void poll(), 3000);
    };
    window.setTimeout(() => void poll(), 3000);
  }, []);

  const clearStartError = useCallback(() => setStartError(null), []);

  const value = useMemo<ComfyStartValue>(
    () => ({ starting, startError, startComfy, clearStartError }),
    [starting, startError, startComfy, clearStartError],
  );

  return <ComfyStartContext.Provider value={value}>{children}</ComfyStartContext.Provider>;
}

export function useComfyStart(): ComfyStartValue {
  const ctx = useContext(ComfyStartContext);
  if (!ctx) throw new Error("useComfyStart must be used within a ComfyStartProvider");
  return ctx;
}

/* The shared `start_comfy` actuator — mono lowercase_underscore label, spinner
   while the rig is coming up, script path in the tooltip. */
export function StartComfyButton({
  className = "btn btn--sm",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { starting, startComfy } = useComfyStart();
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => void startComfy()}
      disabled={starting}
      title={START_SCRIPT}
    >
      {starting ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : null}
      start_comfy
    </button>
  );
}

/* Offline recovery line for the composer tabs: "comfy offline · [start_comfy]".
   Shown when the rig is stopped — the real fix is starting it, not downloading
   weights. */
export function ComfyOfflineHint() {
  const { startError } = useComfyStart();
  return (
    <>
      <p className="rig-hint comfy-start">
        comfy offline ·
        <StartComfyButton />
      </p>
      {startError ? <p className="rig-hint rig-hint--danger">{startError}</p> : null}
    </>
  );
}

/* Weights-missing recovery — only honest when the rig is ONLINE but the preset's
   files are absent. B1: a real in-app download (queue + progress via
   /api/models/weights) with the CLI command kept as the copyable twin. */
interface WeightJob {
  id: string;
  fileKey: string;
  filename: string;
  status: string;
  bytesDone: number;
  bytesTotal: number | null;
  error?: string;
}

function gb(n: number): string {
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function MissingWeightsHint({
  text,
  command,
  preset,
}: {
  text: ReactNode;
  command: string;
  preset?: string;
}) {
  const [jobs, setJobs] = useState<WeightJob[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const startDownload = useCallback(async () => {
    if (!preset || downloading) return;
    setDownloading(true);
    setDlError(null);
    try {
      const res = await fetch("/api/models/weights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      if (!res.ok) throw new Error(`installer ${res.status}`);
      const started = (await res.json()) as { enqueued: WeightJob[] };
      const ids = new Set(started.enqueued.map((j) => j.id));
      if (ids.size === 0) {
        setDlError("nothing to download — files may lack a verified source (use the CLI or check /api/models/weights)");
        setDownloading(false);
        return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch("/api/models/weights", { cache: "no-store" });
          if (!r.ok) return;
          const d = (await r.json()) as { jobs: WeightJob[] };
          const mine = d.jobs.filter((j) => ids.has(j.id));
          setJobs(mine);
          const active = mine.some((j) => j.status === "queued" || j.status === "downloading" || j.status === "verifying");
          if (!active) {
            stopPoll();
            setDownloading(false);
            const failed = mine.find((j) => j.status === "error");
            if (failed) setDlError(failed.error ?? "download failed");
          }
        } catch {
          /* transient poll failure */
        }
      }, 1500);
    } catch (e) {
      setDlError(e instanceof Error ? e.message : "download failed");
      setDownloading(false);
    }
  }, [preset, downloading, stopPoll]);

  const totals = jobs.reduce(
    (a, j) => ({ done: a.done + j.bytesDone, total: a.total + (j.bytesTotal ?? 0) }),
    { done: 0, total: 0 },
  );
  const allDone = jobs.length > 0 && jobs.every((j) => j.status === "done");

  return (
    <div className="rig-hint rig-hint--weights">
      {text}
      {preset && !allDone && (
        <button
          type="button"
          className="word-act rig-hint__copy"
          onClick={() => void startDownload()}
          disabled={downloading}
          title="download the missing weights in the deck"
        >
          {downloading ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : null}
          {downloading
            ? totals.total > 0
              ? `downloading ${gb(totals.done)} / ${gb(totals.total)}`
              : "downloading…"
            : "download here"}
        </button>
      )}
      <button
        type="button"
        className="word-act rig-hint__copy"
        onClick={() => void navigator.clipboard?.writeText(command)}
        title="copy download command"
      >
        <Copy size={12} aria-hidden="true" />
        copy command
      </button>
      {allDone ? <span className="rig-hint__ok">weights installed — re-check runs automatically; restart Comfy if the preset stays red</span> : null}
      {dlError ? <span className="rig-hint--danger">{dlError}</span> : null}
    </div>
  );
}
