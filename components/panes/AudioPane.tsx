"use client";

/**
 * AudioPane — visible workspace switcher for every audio surface.
 *
 * Conductor stays the default live orb, but the older workspace UIs remain
 * addressable through `?tab=` so they do not disappear behind corner cards.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { ConductorSurface } from "@/components/voice-conductor/ConductorSurface";
import { useVoiceWorkspace, type VoiceTab } from "@/lib/hooks/useVoiceWorkspace";

// Secondary surfaces stay lazy so the Conductor path remains light.
const NewsroomSurface = dynamic(
  () => import("@/components/voice-newsroom/NewsroomSurface").then((m) => m.NewsroomSurface),
  { ssr: false, loading: () => <SurfaceLoading label="Newsroom" /> },
);
const LiveVoiceSurface = dynamic(
  () => import("@/components/voice-live/LiveVoiceSurface").then((m) => m.LiveVoiceSurface),
  { ssr: false, loading: () => <SurfaceLoading label="Live" /> },
);
const StudioPane = dynamic(
  () => import("@/components/voice-studio/StudioPane").then((m) => m.StudioPane),
  { ssr: false, loading: () => <SurfaceLoading label="Studio" /> },
);
const LibraryPane = dynamic(
  () => import("@/components/voice-library/LibraryPane").then((m) => m.LibraryPane),
  { ssr: false, loading: () => <SurfaceLoading label="Voices" /> },
);
const VoiceHealthPane = dynamic(
  () => import("@/components/voice-health/VoiceHealthPane").then((m) => m.VoiceHealthPane),
  { ssr: false, loading: () => <SurfaceLoading label="Health" /> },
);
const StageSurface = dynamic(
  () => import("@/components/voice-stage/StageSurface").then((m) => m.StageSurface),
  { ssr: false, loading: () => <SurfaceLoading label="Stage" /> },
);
const TapeSurface = dynamic(
  () => import("@/components/voice-tape/TapeSurface").then((m) => m.TapeSurface),
  { ssr: false, loading: () => <SurfaceLoading label="Tape" /> },
);
const ForumSurface = dynamic(
  () => import("@/components/voice-forum/ForumSurface").then((m) => m.ForumSurface),
  { ssr: false, loading: () => <SurfaceLoading label="Forum" /> },
);

const AUDIO_TABS: readonly { id: VoiceTab; label: string }[] = [
  { id: "conductor", label: "Conductor" },
  { id: "live", label: "Live" },
  { id: "newsroom", label: "Newsroom" },
  { id: "voices", label: "Voices" },
  { id: "studio", label: "Studio" },
  { id: "health", label: "Health" },
  { id: "stage", label: "Stage" },
  { id: "tape", label: "Tape" },
  { id: "forum", label: "Forum" },
];

function SurfaceLoading({ label }: { label: string }) {
  return (
    <div className="p-6 text-sm text-[var(--text-muted)]">Loading {label}…</div>
  );
}

function AudioPaneInner() {
  const workspace = useVoiceWorkspace();

  return (
    <div className="h-full flex flex-col">
      <OmniActivationStrip />
      <div className="control-tabbar" role="tablist" aria-label="Audio workspaces">
        {AUDIO_TABS.map((tab) => {
          const isActive = workspace.tab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`audio-tab-${tab.id}`}
              role="tab"
              aria-controls={`audio-panel-${tab.id}`}
              aria-selected={isActive}
              className={`control-tab${isActive ? " control-tab--active" : ""}`}
              onClick={() => workspace.setTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden">
        <div
          id={`audio-panel-${workspace.tab}`}
          role="tabpanel"
          aria-labelledby={`audio-tab-${workspace.tab}`}
          className="h-full"
        >
          <ActiveAudioSurface tab={workspace.tab} />
        </div>
      </div>
    </div>
  );
}

function ActiveAudioSurface({ tab }: { tab: VoiceTab }) {
  if (tab === "live") return <LiveVoiceSurface />;
  if (tab === "newsroom") return <NewsroomSurface />;
  if (tab === "studio") return <StudioPane />;
  if (tab === "voices") return <LibraryPane />;
  if (tab === "health") return <VoiceHealthPane />;
  if (tab === "stage") return <StageSurface />;
  if (tab === "tape") return <TapeSurface />;
  if (tab === "forum") return <ForumSurface />;
  return <ConductorSurface />;
}

export function AudioPane() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div>}>
      <AudioPaneInner />
    </Suspense>
  );
}

interface OmniResponse {
  status: {
    ready: boolean;
    installed: boolean;
    generationReady: boolean;
    cudaAvailable: boolean | null;
    modelLabel: string;
    modelDir: string;
    weightsBytes: number;
    issues: string[];
    supportedModalities: string[];
    smokeCommand: string;
    fullSmokeCommand: string;
    sidecar?: {
      configured: boolean;
      baseURL: string | null;
      reachable: boolean | null;
      detail: string | null;
    };
  };
  activation: {
    active: boolean;
    activeModalities: string[];
  };
}

function OmniActivationStrip() {
  const [snapshot, setSnapshot] = useState<OmniResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch("/api/voice/omni", { cache: "no-store", signal });
    return readOmniResponse(res, "Omni status");
  }, []);

  const activate = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch("/api/voice/omni", { method: "POST", signal });
    return readOmniResponse(res, "Omni activation");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await load(controller.signal);
        if (!alive) return;
        setSnapshot(data);
      } catch (e) {
        if (alive && !controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Omni status failed");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [activate, load]);

  const activateNow = useCallback(async () => {
    setActivating(true);
    setError(null);
    try {
      const data = await activate();
      if (!mountedRef.current) return;
      setSnapshot(data);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "Omni activation failed");
    } finally {
      if (mountedRef.current) setActivating(false);
    }
  }, [activate]);

  if (loading && !snapshot) return null;

  if (!snapshot) {
    return (
      <OmniStripShell tone="warn">
        <span>Omni audio model status unavailable.</span>
        {error ? <span className="text-[var(--error)]">{error}</span> : null}
      </OmniStripShell>
    );
  }

  const { status, activation: activationState } = snapshot;
  const active = activationState.active;
  const tone = status.ready && active ? (status.generationReady ? "ok" : "warn") : status.ready ? "warn" : "err";
  const displayedModalities = active
    ? activationState.activeModalities
    : status.supportedModalities;
  const modalities = displayedModalities.length > 0
    ? displayedModalities.map(labelForModality).join(", ")
    : "no modalities";
  const activeCopy = activationState.activeModalities.length > 0
    ? `Bound across ${modalities}.`
    : "Active, but no modalities are currently bound.";
  const readyCopy = status.supportedModalities.length > 0
    ? `Click Audio auto-binds ${modalities}.`
    : "No Omni modalities are currently advertised.";

  // Stay quiet when the model is fully ready, active, and generating — the
  // Health corner already surfaces this. Only render when the user needs to
  // act (activate, install, or repair).
  if (status.ready && active && status.generationReady && status.issues.length === 0 && !error) {
    return null;
  }

  return (
    <OmniStripShell tone={tone}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium text-[var(--text-primary)]">
          {status.modelLabel} {active ? "active" : status.ready ? "ready to activate" : "not ready"}
        </span>
        <span className="truncate text-[var(--text-muted)]">
          {active
            ? activeCopy
            : status.ready
              ? readyCopy
              : `Install or repair the local snapshot at ${status.modelDir}.`}
          {" "}
          {status.weightsBytes > 0 ? `${formatGiB(status.weightsBytes)} GiB on disk.` : ""}
          {" "}
          {!status.generationReady && status.ready
            ? "Full local speech generation still needs CUDA or a remote sidecar."
            : ""}
        </span>
      </div>
      {status.ready && !active ? (
        <button
          type="button"
          className="inference-action-btn"
          disabled={activating}
          onClick={() => void activateNow()}
        >
          {activating ? "Activating..." : "Activate"}
        </button>
      ) : null}
      {error ? <span className="text-xs text-[var(--error)]">{error}</span> : null}
      {status.issues.length > 0 ? (
        <span className="max-w-[36rem] truncate text-xs text-[var(--text-muted)]" title={status.issues.join(" | ")}>
          {status.issues[0]}
        </span>
      ) : null}
    </OmniStripShell>
  );
}

function OmniStripShell({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "err";
  children: ReactNode;
}) {
  const color =
    tone === "ok"
      ? "var(--success)"
      : tone === "warn"
        ? "var(--warning)"
        : "var(--error)";
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2 text-xs">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </div>
  );
}

async function readOmniResponse(res: Response, label: string): Promise<OmniResponse> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractApiError(data, `${label} ${res.status}`));
  }
  if (!isOmniResponse(data)) {
    throw new Error(`${label} returned an invalid response`);
  }
  return data;
}

function isOmniResponse(data: unknown): data is OmniResponse {
  if (!data || typeof data !== "object") return false;
  const candidate = data as {
    status?: unknown;
    activation?: unknown;
  };
  return Boolean(candidate.status && candidate.activation);
}

function extractApiError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function labelForModality(id: string): string {
  switch (id) {
    case "stt":
      return "STT";
    case "tts":
      return "TTS";
    case "text":
      return "Text";
    case "vision":
      return "Vision";
    default:
      return id;
  }
}

function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2);
}
