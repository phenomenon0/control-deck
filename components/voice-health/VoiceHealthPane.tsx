"use client";

/**
 * VoiceHealthPane — diagnostics surface for the voice subsystem.
 *
 * Keeps engineering truth (route, provider matrix, latency, transport,
 * recent issues) out of the Live tab so the main surface stays product-like.
 */

import { useEffect, useState, type ReactNode } from "react";

interface ProviderHealth {
  id: string;
  name: string;
  role: "stt" | "tts" | "sidecar";
  configured: boolean;
  reachable: boolean;
  detail?: string;
}

interface RuntimeSnapshot {
  route: {
    preset: string;
    rationale: string;
    stt: { providerId: string; providerName: string; model: string | null } | null;
    tts: { providerId: string; providerName: string; model: string | null; engine: string | null } | null;
  };
  transport: {
    mode: "local-sidecar" | "app-gateway" | "realtime";
    wsUrl: string | null;
    sidecar: "ok" | "unreachable" | "unknown";
  };
  omni?: {
    modelLabel: string;
    modelDir: string;
    ready: boolean;
    installed: boolean;
    generationReady: boolean;
    cudaAvailable: boolean | null;
    weightsBytes: number;
    supportedModalities: string[];
    issues: string[];
    smokeCommand: string;
    fullSmokeCommand: string;
    sidecar?: {
      configured: boolean;
      baseURL: string | null;
      reachable: boolean | null;
      detail: string | null;
    };
  };
  providers: ProviderHealth[];
  recentSessions: Array<{
    id: string;
    createdAt: string;
    mode: string;
    latencySummary: {
      sttP50Ms?: number;
      sttP95Ms?: number;
      ttsP50Ms?: number;
      ttsP95Ms?: number;
      turns?: number;
    } | null;
  }>;
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "err" | "neutral";
  children: ReactNode;
}) {
  const color =
    tone === "ok"
      ? "var(--success)"
      : tone === "warn"
      ? "var(--warning)"
      : tone === "err"
      ? "var(--error)"
      : "var(--text-muted)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-mono"
      style={{ color, borderColor: color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

export function VoiceHealthPane() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/voice/runtime");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Failed to load runtime");
        setSnapshot(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full overflow-auto px-6 py-5 space-y-6">
      <header className="space-y-1">
        <div className="label">Diagnostics</div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Health</h1>
        <p className="text-sm text-[var(--text-muted)] max-w-3xl">
          The single place where engineering truth lives. Route decisions, provider reachability, and latency history for the voice subsystem.
        </p>
      </header>

      {loading ? <div className="card text-sm text-[var(--text-muted)]">Loading runtime…</div> : null}
      {error ? <div className="card text-sm text-[var(--error)]">{error}</div> : null}

      {snapshot ? (
        <>
          <section className="card space-y-3">
            <div>
              <div className="label">Current route</div>
              <h2 className="text-sm font-medium text-[var(--text-primary)]">
                Route selected: <span className="capitalize">{snapshot.route.preset}</span>
              </h2>
            </div>
            <div className="text-sm text-[var(--text-muted)]">{snapshot.route.rationale}</div>
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div className="card-sub">
                <div className="text-xs text-[var(--text-muted)]">STT</div>
                <div className="text-[var(--text-primary)]">
                  {snapshot.route.stt
                    ? `${snapshot.route.stt.providerName}${snapshot.route.stt.model ? ` · ${snapshot.route.stt.model}` : ""}`
                    : "—"}
                </div>
              </div>
              <div className="card-sub">
                <div className="text-xs text-[var(--text-muted)]">TTS</div>
                <div className="text-[var(--text-primary)]">
                  {snapshot.route.tts
                    ? `${snapshot.route.tts.providerName}${snapshot.route.tts.engine ? ` · ${snapshot.route.tts.engine}` : snapshot.route.tts.model ? ` · ${snapshot.route.tts.model}` : ""}`
                    : "—"}
                </div>
              </div>
            </div>
          </section>

          {snapshot.omni ? (
            <section className="card space-y-3">
              <div>
                <div className="label">End-to-end local model</div>
                <h2 className="text-sm font-medium text-[var(--text-primary)]">
                  {snapshot.omni.modelLabel}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill tone={snapshot.omni.ready ? "ok" : snapshot.omni.installed ? "warn" : "err"}>
                  snapshot · {snapshot.omni.ready ? "ready" : snapshot.omni.installed ? "incomplete" : "missing"}
                </Pill>
                <Pill tone={snapshot.omni.generationReady ? "ok" : "warn"}>
                  generation · {snapshot.omni.generationReady ? "ready" : "needs CUDA/sidecar"}
                </Pill>
                {snapshot.omni.sidecar?.configured ? (
                  <Pill tone={snapshot.omni.sidecar.reachable === true ? "ok" : snapshot.omni.sidecar.reachable === false ? "err" : "neutral"}>
                    sidecar · {snapshot.omni.sidecar.reachable === true ? "reachable" : snapshot.omni.sidecar.reachable === false ? "unreachable" : "configured"}
                  </Pill>
                ) : (
                  <Pill tone="neutral">sidecar · unset</Pill>
                )}
                <Pill tone="neutral">
                  modes · {snapshot.omni.supportedModalities.map(labelForModality).join(", ")}
                </Pill>
                {snapshot.omni.weightsBytes > 0 ? (
                  <Pill tone="neutral">weights · {formatGiB(snapshot.omni.weightsBytes)} GiB</Pill>
                ) : null}
              </div>
              {snapshot.omni.sidecar?.configured && snapshot.omni.sidecar.baseURL ? (
                <div className="text-xs text-[var(--text-muted)] break-all">
                  sidecar URL · {snapshot.omni.sidecar.baseURL}
                  {snapshot.omni.sidecar.detail ? ` · ${snapshot.omni.sidecar.detail}` : ""}
                </div>
              ) : (
                <div className="text-xs text-[var(--text-muted)]">
                  Set <code className="font-mono">OMNI_SIDECAR_URL</code> to a host running the Qwen Omni runtime so /api/voice/omni/respond can serve full local speech.
                </div>
              )}
              <div className="text-xs text-[var(--text-muted)] break-all">
                {snapshot.omni.modelDir}
              </div>
              {snapshot.omni.issues.length > 0 ? (
                <div className="text-xs text-[var(--warning)]">
                  {snapshot.omni.issues[0]}
                </div>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2 text-xs">
                <code className="card-sub text-[var(--text-muted)]">{snapshot.omni.smokeCommand}</code>
                <code className="card-sub text-[var(--text-muted)]">{snapshot.omni.fullSmokeCommand}</code>
              </div>
            </section>
          ) : null}

          <section className="card space-y-3">
            <div>
              <div className="label">Transport</div>
              <h2 className="text-sm font-medium text-[var(--text-primary)]">How the browser talks to the voice stack</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill tone={snapshot.transport.sidecar === "ok" ? "ok" : snapshot.transport.sidecar === "unreachable" ? "err" : "neutral"}>
                sidecar · {snapshot.transport.sidecar}
              </Pill>
              <Pill tone="neutral">mode · {snapshot.transport.mode}</Pill>
              {snapshot.transport.wsUrl ? (
                <Pill tone="neutral">ws · {snapshot.transport.wsUrl}</Pill>
              ) : null}
            </div>
          </section>

          <section className="card space-y-3">
            <div>
              <div className="label">Provider matrix</div>
              <h2 className="text-sm font-medium text-[var(--text-primary)]">Configured vs reachable</h2>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {snapshot.providers.map((p) => (
                <div key={`${p.role}-${p.id}`} className="card-sub space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-[var(--text-primary)]">{p.name}</div>
                    <span className="text-xs text-[var(--text-muted)] uppercase">{p.role}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Pill tone={p.configured ? "ok" : "warn"}>
                      {p.configured ? "configured" : "unconfigured"}
                    </Pill>
                    <Pill tone={p.reachable ? "ok" : p.configured ? "err" : "neutral"}>
                      {p.reachable ? "reachable" : p.configured ? "unreachable" : "—"}
                    </Pill>
                  </div>
                  {p.detail ? <div className="text-xs text-[var(--text-muted)]">{p.detail}</div> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="card space-y-3">
            <div>
              <div className="label">Recent sessions</div>
              <h2 className="text-sm font-medium text-[var(--text-primary)]">Latency for the last conversations</h2>
            </div>
            {snapshot.recentSessions.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)]">No voice sessions recorded yet.</div>
            ) : (
              <div className="space-y-2 text-sm">
                {snapshot.recentSessions.slice(0, 10).map((s) => (
                  <div key={s.id} className="card-sub flex items-center justify-between">
                    <div className="text-[var(--text-muted)] text-xs tabular-nums">
                      {new Date(s.createdAt).toLocaleTimeString()}
                    </div>
                    <div className="flex gap-3 text-xs text-[var(--text-muted)] tabular-nums">
                      {s.latencySummary?.sttP50Ms != null ? <span>STT p50 {s.latencySummary.sttP50Ms}ms</span> : null}
                      {s.latencySummary?.ttsP50Ms != null ? <span>TTS p50 {s.latencySummary.ttsP50Ms}ms</span> : null}
                      {s.latencySummary?.turns != null ? <span>{s.latencySummary.turns} turns</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
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
