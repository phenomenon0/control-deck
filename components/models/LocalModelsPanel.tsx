"use client";

/**
 * LocalModelsPanel — per-modality local-first overview.
 *
 * One row per modality (text, vision, embeddings, STT, TTS, …) showing:
 *   - The recommended local default at the current preset
 *   - Whether it's already installed locally
 *   - A Pull button for Ollama-backed defaults when Ollama is reachable
 *   - A Cancel button while a pull is in progress
 *   - Live progress from the shared Ollama pull store
 *   - A preset switcher (quick / balanced / quality)
 *   - A "Bootstrap <preset> set" header button that kicks off Ollama pulls
 *     for text/vision/embedding in parallel and warmup POSTs for STT/TTS
 *     (the sidecar already bundles Piper/Whisper — the warmup forces the
 *     engine to bind into memory so it shows green in the next status poll)
 *
 * Data comes from GET /api/local-models/status. Pulls go through the same
 * useModelPull store used everywhere else so progress shows up wherever
 * ModelPullStrip is mounted.
 */

import { useMemo, useState, useCallback } from "react";

import { useLocalModelsStatus, type LocalModalityStatus } from "@/lib/hooks/useLocalModelsStatus";
import { useModelPull } from "@/lib/hooks/useModelPull";
import type { LocalPreset } from "@/lib/inference/local-defaults";

const PRESET_OPTIONS: Array<{ id: LocalPreset; label: string; hint: string }> = [
  { id: "quick", label: "Quick", hint: "Smallest models. Fastest first token, less depth." },
  { id: "balanced", label: "Balanced", hint: "Sensible defaults. First-run pick." },
  { id: "quality", label: "Quality", hint: "Biggest that fits a laptop. Closest to cloud." },
];

function formatSize(mb: number | null): string {
  if (mb == null) return "—";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Minimal 10ms silent mono 16kHz WAV — ~364 bytes, enough for the sidecar to bind Whisper. */
function buildSilentWav(): Blob {
  const sampleRate = 16_000;
  const frames = 160; // 10ms
  const byteRate = sampleRate * 2;
  const dataLen = frames * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  let p = 0;
  const writeStr = (s: string) => { for (const c of s) view.setUint8(p++, c.charCodeAt(0)); };
  writeStr("RIFF");
  view.setUint32(p, 36 + dataLen, true); p += 4;
  writeStr("WAVE");
  writeStr("fmt ");
  view.setUint32(p, 16, true); p += 4;
  view.setUint16(p, 1, true); p += 2; // PCM
  view.setUint16(p, 1, true); p += 2; // mono
  view.setUint32(p, sampleRate, true); p += 4;
  view.setUint32(p, byteRate, true); p += 4;
  view.setUint16(p, 2, true); p += 2;
  view.setUint16(p, 16, true); p += 2;
  writeStr("data");
  view.setUint32(p, dataLen, true); p += 4;
  // remaining bytes default to 0 — that's our silence
  return new Blob([buf], { type: "audio/wav" });
}

type SweepStatus = "idle" | "pending" | "running" | "ok" | "error";

interface LocalModelsPanelProps {
  /** Optional controlled preset. When omitted the panel owns the state. */
  preset?: LocalPreset;
  onPresetChange?: (preset: LocalPreset) => void;
}

export function LocalModelsPanel({ preset: controlledPreset, onPresetChange }: LocalModelsPanelProps) {
  const [internalPreset, setInternalPreset] = useState<LocalPreset>("balanced");
  const preset = controlledPreset ?? internalPreset;

  const setPreset = useCallback(
    (p: LocalPreset) => {
      if (controlledPreset === undefined) setInternalPreset(p);
      onPresetChange?.(p);
    },
    [controlledPreset, onPresetChange],
  );

  const { modalities, runners, loading, error, refresh } = useLocalModelsStatus(preset);
  const { progress, pull, abort } = useModelPull();

  // Per-row sweep status: tracks the "Bootstrap set" button's effect on
  // non-Ollama rows (voice warmup) and any rows already installed.
  const [sweep, setSweep] = useState<Record<string, SweepStatus>>({});
  const [sweepRunning, setSweepRunning] = useState(false);

  const rows = useMemo(() => {
    return modalities.map((row) => {
      const tag = row.default.id;
      const live = tag ? progress.get(tag) : null;
      return { row, live };
    });
  }, [modalities, progress]);

  const handlePull = useCallback(
    async (row: LocalModalityStatus) => {
      const tag = row.default.id;
      if (!tag || row.default.runner !== "ollama") return;
      try {
        await pull(tag);
      } finally {
        void refresh();
      }
    },
    [pull, refresh],
  );

  const handleCancel = useCallback(
    (row: LocalModalityStatus) => {
      const tag = row.default.id;
      if (!tag) return;
      abort(tag);
    },
    [abort],
  );

  const warmupStt = useCallback(async (): Promise<void> => {
    const form = new FormData();
    form.append("audio", buildSilentWav(), "warmup.wav");
    form.append("preset", preset);
    form.append("mimeType", "audio/wav");
    const res = await fetch("/api/voice/stt", { method: "POST", body: form });
    if (!res.ok) throw new Error(`stt warmup ${res.status}`);
  }, [preset]);

  const warmupTts = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: ".", preset }),
    });
    if (!res.ok) throw new Error(`tts warmup ${res.status}`);
  }, [preset]);

  const runSweep = useCallback(async () => {
    setSweepRunning(true);
    const next: Record<string, SweepStatus> = {};
    const tasks: Array<Promise<void>> = [];

    for (const { row } of rows) {
      const { modality, default: def, installed, canPull } = row;
      if (installed) {
        next[modality] = "ok";
        continue;
      }
      if (def.runner === "ollama") {
        if (!def.id || !canPull) {
          next[modality] = "error";
          continue;
        }
        next[modality] = "running";
        const tag = def.id;
        tasks.push(
          pull(tag)
            .then(() => { setSweep((s) => ({ ...s, [modality]: "ok" })); })
            .catch(() => { setSweep((s) => ({ ...s, [modality]: "error" })); }),
        );
      } else if (def.runner === "voice-sidecar") {
        if (!runners.voiceSidecar.reachable) {
          next[modality] = "error";
          continue;
        }
        next[modality] = "running";
        const warmup = modality === "stt" ? warmupStt : modality === "tts" ? warmupTts : null;
        if (!warmup) {
          next[modality] = "error";
          continue;
        }
        tasks.push(
          warmup()
            .then(() => { setSweep((s) => ({ ...s, [modality]: "ok" })); })
            .catch(() => { setSweep((s) => ({ ...s, [modality]: "error" })); }),
        );
      } else {
        next[modality] = "error"; // unavailable — sweep can't help
      }
    }

    setSweep(next);
    try {
      await Promise.allSettled(tasks);
    } finally {
      setSweepRunning(false);
      void refresh();
    }
  }, [rows, pull, warmupStt, warmupTts, runners.voiceSidecar.reachable, refresh]);

  const sweepCounts = useMemo(() => {
    let ok = 0;
    let total = 0;
    for (const { row } of rows) {
      if (row.default.runner === "unavailable") continue;
      total += 1;
      const s = sweep[row.modality];
      if (s === "ok" || row.installed) ok += 1;
    }
    return { ok, total };
  }, [rows, sweep]);

  return (
    <section className="warp-pane-card p-4 mb-6 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="label">Local models</div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Local-first defaults by modality
          </h2>
          <p className="text-sm text-[var(--text-muted)] max-w-2xl mt-1">
            One recommended model per modality. Pull it here and the rest of the app
            will use it without any further wiring.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void runSweep()}
            disabled={sweepRunning || loading}
            className="btn btn-primary text-xs"
            title="Pull Ollama defaults in parallel; warm up the voice sidecar so Whisper + Piper/xtts/chatterbox bind into memory."
          >
            {sweepRunning
              ? `Bootstrapping… ${sweepCounts.ok}/${sweepCounts.total}`
              : `Bootstrap ${preset} set`}
          </button>
          <div className="flex gap-1 rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-1">
            {PRESET_OPTIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                title={p.hint}
                className={`px-3 py-1 text-xs rounded-[4px] transition-colors ${
                  preset === p.id
                    ? "bg-[var(--accent)] text-[var(--accent-fg,white)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className={`pill--mono ${
            runners.ollama.reachable ? "text-[var(--success)]" : "text-[var(--error)]"
          }`}
        >
          Ollama {runners.ollama.reachable ? "online" : "offline"}
        </span>
        <span
          className={`pill--mono ${
            runners.voiceSidecar.reachable ? "text-[var(--success)]" : "text-[var(--error)]"
          }`}
        >
          Voice sidecar {runners.voiceSidecar.reachable ? "online" : "offline"}
        </span>
        {error ? <span className="pill--mono text-[var(--error)]">{error}</span> : null}
        {loading ? <span className="pill--mono text-[var(--text-muted)]">loading…</span> : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map(({ row, live }) => {
          const { modality, name, description, default: def, installed, canPull, hint } = row;
          const isPulling = !!live && (live.phase === "queued" || live.phase === "pulling");
          const pullDone = live?.phase === "done";
          const pullErr = live?.phase === "error";
          const sweepStatus = sweep[modality];
          const sweepWarmup = sweepStatus === "running" && def.runner === "voice-sidecar";

          return (
            <div
              key={modality}
              className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">{name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{description}</div>
                </div>
                <div className="text-right text-xs">
                  {installed || pullDone || sweepStatus === "ok" ? (
                    <span className="pill--mono text-[var(--success)]">installed</span>
                  ) : def.runner === "unavailable" ? (
                    <span className="pill--mono text-[var(--text-muted)]">n/a</span>
                  ) : sweepStatus === "error" ? (
                    <span className="pill--mono text-[var(--error)]">sweep failed</span>
                  ) : (
                    <span className="pill--mono text-[var(--text-muted)]">not installed</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-[var(--text-primary)] truncate" title={def.id ?? undefined}>
                    {def.label}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] tabular-nums">
                    {formatSize(def.sizeMb)} · ≈{formatLatency(def.expectedP50Ms)} p50
                  </div>
                </div>
                {isPulling ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-[var(--text-muted)]">
                      {Math.round(live?.overallPct ?? 0)}%
                    </span>
                    <button
                      type="button"
                      className="btn text-xs"
                      onClick={() => handleCancel(row)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : canPull && !installed && !pullDone ? (
                  <button
                    type="button"
                    className="btn btn-primary text-xs"
                    onClick={() => handlePull(row)}
                  >
                    Pull
                  </button>
                ) : sweepWarmup ? (
                  <span className="text-xs text-[var(--text-muted)]">warming up…</span>
                ) : null}
              </div>

              {isPulling && live ? (
                <div className="space-y-1">
                  <div className="h-1 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ease-out"
                      style={{ width: `${Math.max(2, live.overallPct)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] tabular-nums truncate">
                    {live.statusLine}
                  </div>
                </div>
              ) : null}

              {pullErr && live?.error ? (
                <div className="text-xs text-[var(--error)] truncate" title={live.error}>
                  {live.error}
                </div>
              ) : null}

              {hint ? (
                <div className="text-[11px] text-[var(--text-muted)] leading-snug">{hint}</div>
              ) : (
                <div className="text-[11px] text-[var(--text-muted)] leading-snug italic">
                  {def.note}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
