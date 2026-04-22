"use client";

import type { GpuStats } from "@/lib/hooks/useSystemStats";
import type { LoadedOllamaModel } from "@/app/api/ollama/ps/route";
import { bytes } from "./types";

/**
 * Top-of-page KPI cards. Shared by Overview + Models tabs so the numbers
 * are always visible regardless of which tab the user picked.
 */
export function KpiStrip({
  gpu,
  loadedModels,
  installedCount,
  installedTotalBytes,
}: {
  gpu: GpuStats | null;
  loadedModels: LoadedOllamaModel[];
  installedCount: number;
  installedTotalBytes: number;
}) {
  const loadedVram = loadedModels.reduce((s, m) => s + m.size_vram, 0);
  return (
    <div className="hardware-kpis">
      <Kpi
        label="GPU"
        value={gpu ? `${gpu.utilization}%` : "—"}
        sub={gpu ? `${gpu.temperature}°C · ${gpu.name}` : "no GPU"}
      />
      <Kpi
        label="VRAM"
        value={gpu ? `${gpu.memoryPercent.toFixed(0)}%` : "—"}
        sub={
          gpu
            ? `${bytes(gpu.memoryUsed * 1024 * 1024)} / ${bytes(gpu.memoryTotal * 1024 * 1024)}`
            : "—"
        }
        fill={gpu?.memoryPercent ?? 0}
      />
      <Kpi
        label="Loaded"
        value={loadedModels.length.toString()}
        sub={loadedModels.length > 0 ? `${bytes(loadedVram)} in VRAM` : "nothing resident"}
      />
      <Kpi
        label="Installed"
        value={installedCount.toString()}
        sub={installedCount > 0 ? `${bytes(installedTotalBytes)} on disk` : "no Ollama models"}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  fill,
}: {
  label: string;
  value: string;
  sub?: string;
  fill?: number;
}) {
  return (
    <div className="hardware-kpi">
      <div className="hardware-kpi-label">{label}</div>
      <div className="hardware-kpi-value">{value}</div>
      {sub && <div className="hardware-kpi-sub">{sub}</div>}
      {fill !== undefined && (
        <div className="hardware-kpi-bar">
          <div className="hardware-kpi-bar-fill" style={{ width: `${Math.min(100, fill)}%` }} />
        </div>
      )}
    </div>
  );
}
