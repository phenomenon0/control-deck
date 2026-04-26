"use client";

import { useMemo } from "react";
import type { GpuStats } from "@/lib/hooks/useSystemStats";
import type { LoadedOllamaModel } from "@/app/api/ollama/ps/route";
import { useLocalModelsStatus, type LocalModalityStatus } from "@/lib/hooks/useLocalModelsStatus";
import type { Modality } from "@/lib/inference/types";
import { bytes } from "./types";

/**
 * The hardware landing — answers two questions in one glance, per modality:
 *   1. What's loaded right now? (HOT dot + model name)
 *   2. What can I load without leaving here? (recommended default + a status hint)
 *
 * Replaces the old "GPU / VRAM / Loaded / Installed" KPI banners. Those four
 * numbers compressed all modalities into one count — the user couldn't tell
 * at a glance whether vision was wired up, whether the voice sidecar was
 * alive, or which of the loaded models was for which job.
 *
 * Only the wired-up modalities (runner !== "unavailable") render as cards.
 * The cloud-only ones show as a small footer row so the user still sees the
 * gap, without giving them visual weight.
 */
const PRIMARY: Modality[] = ["text", "vision", "stt", "tts", "embedding"];

export function ModalityGlance({
  gpu,
  loaded,
}: {
  gpu: GpuStats | null;
  loaded: LoadedOllamaModel[];
}) {
  const { modalities, runners, loading } = useLocalModelsStatus("balanced");

  const byMod = useMemo(() => {
    const m = new Map<Modality, LocalModalityStatus>();
    modalities.forEach((s) => m.set(s.modality, s));
    return m;
  }, [modalities]);

  const cards = PRIMARY.map((id) => byMod.get(id)).filter(
    (s): s is LocalModalityStatus => Boolean(s),
  );
  const unwired = modalities.filter(
    (s) => s.default.runner === "unavailable" && !PRIMARY.includes(s.modality),
  );

  const hotByName = new Map(loaded.map((m) => [m.name, m]));
  const hotCount = cards.filter((c) => modalityIsHot(c, hotByName, runners)).length;
  const readyCount = cards.filter(
    (c) => !modalityIsHot(c, hotByName, runners) && c.installed,
  ).length;

  return (
    <section className="hardware-glance" aria-label="Modality status">
      <header className="hardware-glance-head">
        <span className="hardware-glance-title">Modalities</span>
        <span className="hardware-glance-meta">
          {loading
            ? "probing…"
            : `${hotCount} loaded · ${readyCount} ready${unwired.length ? ` · ${unwired.length} not wired` : ""}`}
        </span>
        <GpuPill gpu={gpu} />
      </header>

      <ul className="hardware-glance-grid">
        {cards.map((c) => (
          <ModalityCard
            key={c.modality}
            status={c}
            hotByName={hotByName}
            runners={runners}
          />
        ))}
      </ul>

      {unwired.length > 0 && (
        <div className="hardware-glance-foot">
          <span className="hardware-glance-foot-label">Cloud-only:</span>
          {unwired.map((u) => (
            <span key={u.modality} className="hardware-glance-foot-chip" title={u.hint ?? ""}>
              {u.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

interface RunnerSnapshot {
  ollama: { reachable: boolean; installed: string[] };
  voiceSidecar: { reachable: boolean; wsUrl: string | null };
}

function ModalityCard({
  status,
  hotByName,
  runners,
}: {
  status: LocalModalityStatus;
  hotByName: Map<string, LoadedOllamaModel>;
  runners: RunnerSnapshot;
}) {
  const hot = hotLoadedModel(status, hotByName, runners);
  const isHot = Boolean(hot.name);
  const tone = cardTone({ isHot, status });
  const modelName = hot.name ?? status.default.label;
  const sub = subline({ status, hot, runners });

  return (
    <li className={`hardware-glance-card hardware-glance-card--${tone}`} title={status.hint ?? ""}>
      <div className="hardware-glance-card-row">
        <span className={`hardware-glance-dot hardware-glance-dot--${tone}`} aria-hidden />
        <span className="hardware-glance-card-label">{status.name}</span>
        {isHot && <span className="hardware-glance-card-tag">HOT</span>}
      </div>
      <div className="hardware-glance-card-model" title={modelName}>
        {modelName || "—"}
      </div>
      <div className="hardware-glance-card-sub">{sub}</div>
    </li>
  );
}

function GpuPill({ gpu }: { gpu: GpuStats | null }) {
  if (!gpu) {
    return <span className="hardware-glance-gpu hardware-glance-gpu--off">no GPU</span>;
  }
  return (
    <span
      className="hardware-glance-gpu"
      title={`${gpu.name} · ${gpu.utilization}% util · ${gpu.temperature}°C`}
    >
      <span className="hardware-glance-gpu-name">{shortGpu(gpu.name)}</span>
      <span className="hardware-glance-gpu-util">{gpu.utilization}%</span>
      <span className="hardware-glance-gpu-vram">
        {bytes(gpu.memoryUsed * 1024 * 1024)} / {bytes(gpu.memoryTotal * 1024 * 1024)}
      </span>
    </span>
  );
}

/** Trim "NVIDIA GeForce RTX 5070 Ti" → "RTX 5070 Ti" so the pill stays small. */
function shortGpu(name: string): string {
  return name
    .replace(/^NVIDIA\s+/i, "")
    .replace(/^GeForce\s+/i, "")
    .replace(/^Apple\s+/i, "")
    .trim();
}

type Tone = "hot" | "ready" | "missing" | "offline";

function cardTone({ isHot, status }: { isHot: boolean; status: LocalModalityStatus }): Tone {
  if (isHot) return "hot";
  if (status.installed) return "ready";
  if (status.canPull || status.default.runner === "voice-sidecar") return "missing";
  return "offline";
}

function hotLoadedModel(
  status: LocalModalityStatus,
  hotByName: Map<string, LoadedOllamaModel>,
  runners: RunnerSnapshot,
): { name: string | null; sizeVram?: number } {
  if (status.default.runner === "ollama") {
    // Match the recommended default first, but fall back to *any* loaded
    // ollama model that smells like this modality (vision tags contain "vl"
    // or "vision"; embeddings contain "embed"; everything else is text).
    const want = status.default.id;
    if (want) {
      const exact = [...hotByName.values()].find((m) => matchesOllamaTag(want, m.name));
      if (exact) return { name: exact.name, sizeVram: exact.size_vram };
    }
    const fallback = [...hotByName.values()].find((m) => guessModality(m.name) === status.modality);
    if (fallback) return { name: fallback.name, sizeVram: fallback.size_vram };
  }
  if (status.default.runner === "voice-sidecar" && runners.voiceSidecar.reachable) {
    return { name: status.default.label };
  }
  return { name: null };
}

function modalityIsHot(
  status: LocalModalityStatus,
  hotByName: Map<string, LoadedOllamaModel>,
  runners: RunnerSnapshot,
): boolean {
  return Boolean(hotLoadedModel(status, hotByName, runners).name);
}

function subline({
  status,
  hot,
  runners,
}: {
  status: LocalModalityStatus;
  hot: { name: string | null; sizeVram?: number };
  runners: RunnerSnapshot;
}): string {
  if (hot.name) {
    if (hot.sizeVram && hot.sizeVram > 0) return `loaded · ${bytes(hot.sizeVram)} VRAM`;
    return "loaded";
  }
  if (status.installed) {
    return status.default.runner === "voice-sidecar" ? "sidecar ready" : "installed · idle";
  }
  if (status.default.runner === "voice-sidecar") {
    return runners.voiceSidecar.reachable ? "sidecar idle" : "sidecar offline";
  }
  if (status.canPull) return "pull-ready";
  if (status.default.runner === "ollama" && !runners.ollama.reachable) return "ollama offline";
  return "not wired";
}

function matchesOllamaTag(want: string, candidate: string): boolean {
  if (candidate === want) return true;
  if (!want.includes(":") && candidate === `${want}:latest`) return true;
  return false;
}

/** Heuristic for matching a loaded ollama tag to a modality. Used as a
 *  fallback when the user has loaded a model that's *not* the recommended
 *  default — we still want to surface it on the right card. */
function guessModality(name: string): Modality {
  const n = name.toLowerCase();
  if (n.includes("embed") || n.includes("nomic") || n.includes("minilm") || n.includes("mxbai")) {
    return "embedding";
  }
  if (n.includes("-vl") || n.includes("vision") || n.includes("llava") || n.includes("minicpm-v")) {
    return "vision";
  }
  return "text";
}
