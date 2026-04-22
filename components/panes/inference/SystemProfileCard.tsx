"use client";

/**
 * Hardware summary card for the System tab. Shows GPU, RAM, CPU, backend,
 * and storage with small usage bars where meaningful.
 */

import type { SystemProfile, InferenceBackend } from "@/lib/system/detect";

const BACKEND_LABEL: Record<InferenceBackend, string> = {
  metal: "Metal (Apple GPU)",
  cuda: "CUDA (NVIDIA)",
  rocm: "ROCm (AMD)",
  cpu: "CPU only",
};

export function SystemProfileCard({ profile }: { profile: SystemProfile }) {
  const gpu = profile.gpu;
  const storage = profile.storage;
  const backendColor = profile.backend === "cpu"
    ? "var(--warning)"
    : "var(--success)";

  return (
    <section className="system-profile">
      <div className="system-profile-head">
        <div>
          <div className="label">Hardware</div>
          <h2>{gpu?.name ?? profile.cpuModel}</h2>
          <p>
            {profile.platform} · {profile.cpuCores} cores · {profile.mode} mode
          </p>
        </div>
        <div className="system-backend-chip" style={{ color: backendColor }}>
          <span className={`inference-dot inference-dot--${profile.backend === "cpu" ? "warn" : "ok"}`} />
          <span>{BACKEND_LABEL[profile.backend]}</span>
        </div>
      </div>

      <div className="system-profile-grid">
        <SystemStat
          label={gpu?.unifiedMemory ? "Unified memory budget" : "VRAM"}
          primary={gpu ? `${(gpu.vram / 1024).toFixed(1)} GB` : "—"}
          secondary={gpu?.unifiedMemory ? "60% of system RAM reserved for inference" : undefined}
          capacity={gpu?.vram ?? 0}
          unit="GB"
          scale={1024}
        />
        <SystemStat
          label="System RAM"
          primary={`${profile.ram} GB`}
          capacity={profile.ram}
          unit="GB"
          scale={1}
        />
        <SystemStat
          label="Storage"
          primary={storage ? `${storage.freeGb} GB free` : "—"}
          secondary={storage ? `of ${storage.totalGb} GB total` : undefined}
          capacity={storage?.freeGb ?? 0}
          warnBelow={20}
          unit="GB"
          scale={1}
        />
        <SystemStat
          label="CPU cores"
          primary={`${profile.cpuCores}`}
          secondary={profile.isIntel ? "Intel" : undefined}
        />
      </div>
    </section>
  );
}

function SystemStat({
  label,
  primary,
  secondary,
  capacity,
  unit,
  scale,
  warnBelow,
}: {
  label: string;
  primary: string;
  secondary?: string;
  capacity?: number;
  unit?: string;
  scale?: number;
  warnBelow?: number;
}) {
  const sized = scale && capacity !== undefined ? capacity / scale : capacity;
  const warn = warnBelow !== undefined && sized !== undefined && sized < warnBelow;
  return (
    <div className="system-stat">
      <div className="system-stat-label">{label}</div>
      <div className={`system-stat-primary${warn ? " system-stat-primary--warn" : ""}`}>
        {primary}
      </div>
      {secondary && <div className="system-stat-secondary">{secondary}</div>}
      {unit && sized !== undefined && sized > 0 && (
        <div className="system-stat-bar">
          <div
            className={`system-stat-bar-fill${warn ? " system-stat-bar-fill--warn" : ""}`}
            style={{ width: `${Math.min(100, sized * 2)}%` }}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
