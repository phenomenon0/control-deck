"use client";

/**
 * AudioPane — Audio surface.
 *
 * Tabs: Conductor (orb live talk wired to /api/voice/omni/respond), Voices
 * (library), Studio (cloning workflow), Health (diagnostics). The earlier
 * wireframe-only Newsroom/Stage/Tape/Forum tabs were dropped — they were
 * unwired scaffolds with no model behind them.
 *
 * Active tab + asset + job are URL-persisted via `useVoiceWorkspace`. Old
 * `?tab=live` / `?tab=assistant` redirect to `conductor`; `?tab=library`
 * redirects to `voices`. Old `?tab=newsroom|stage|tape|forum` also redirect
 * to `conductor` so deep-links don't 404.
 */

import dynamic from "next/dynamic";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { ConductorSurface } from "@/components/voice-conductor/ConductorSurface";
import { useVoiceWorkspace, type VoiceTab } from "@/lib/hooks/useVoiceWorkspace";

const StudioPane = dynamic(
  () => import("@/components/voice-studio/StudioPane").then((m) => m.StudioPane),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

const LibraryPane = dynamic(
  () => import("@/components/voice-library/LibraryPane").then((m) => m.LibraryPane),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

const VoiceHealthPane = dynamic(
  () => import("@/components/voice-health/VoiceHealthPane").then((m) => m.VoiceHealthPane),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

interface TabDef {
  id: VoiceTab;
  label: string;
  Component: ComponentType;
}

const TABS: readonly TabDef[] = [
  { id: "conductor", label: "Conductor", Component: ConductorSurface },
  { id: "voices",    label: "Voices",    Component: LibraryPane      },
  { id: "studio",    label: "Studio",    Component: StudioPane       },
  { id: "health",    label: "Health",    Component: VoiceHealthPane  },
];

function AudioPaneInner() {
  const { tab, setTab } = useVoiceWorkspace();
  const ActiveComponent = TABS.find((t) => t.id === tab)?.Component ?? ConductorSurface;

  return (
    <div className="h-full flex flex-col">
      <div className="control-tabbar">
        {TABS.map((t) => {
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`control-tab${isActive ? " control-tab--active" : ""}`}
              aria-pressed={isActive}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <OmniActivationStrip />
      <div className="flex-1 overflow-hidden">
        <ActiveComponent />
      </div>
    </div>
  );
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
  const autoStartedRef = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/voice/omni", { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as OmniResponse | null;
    if (!res.ok || !data) throw new Error(data && "status" in data ? "Omni status failed" : `Omni status ${res.status}`);
    setSnapshot(data);
    return data;
  }, []);

  const activate = useCallback(async () => {
    setActivating(true);
    setError(null);
    try {
      const res = await fetch("/api/voice/omni", { method: "POST" });
      const data = (await res.json().catch(() => null)) as OmniResponse | { error?: string } | null;
      if (!res.ok) {
        const msg = data && "error" in data && data.error ? data.error : `Omni activation ${res.status}`;
        throw new Error(msg);
      }
      setSnapshot(data as OmniResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Omni activation failed");
    } finally {
      setActivating(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const data = await load();
        if (!alive) return;
        if (data.status.ready && !data.activation.active && !autoStartedRef.current) {
          autoStartedRef.current = true;
          await activate();
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Omni status failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [activate, load]);

  if (loading && !snapshot) {
    return (
      <div className="border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2 text-xs text-[var(--text-muted)]">
        Checking local Omni audio model...
      </div>
    );
  }

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
  const modalities = status.supportedModalities.map(labelForModality).join(", ");

  return (
    <OmniStripShell tone={tone}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium text-[var(--text-primary)]">
          {status.modelLabel} {active ? "active" : status.ready ? "ready to activate" : "not ready"}
        </span>
        <span className="truncate text-[var(--text-muted)]">
          {active
            ? `Bound across ${modalities}.`
            : status.ready
              ? `Click Audio auto-binds ${modalities}.`
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
          onClick={() => void activate()}
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
