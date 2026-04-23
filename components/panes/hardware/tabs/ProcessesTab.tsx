"use client";

import type { GpuProcess } from "@/lib/hardware/gpu-types";
import { PROVIDER_LABEL } from "@/lib/hardware/gpu-types";
import { bytes } from "../types";

export function ProcessesTab({
  processes,
  supported,
}: {
  processes: GpuProcess[];
  supported: boolean;
}) {
  if (!supported) {
    return (
      <section className="hardware-panel">
        <header>
          <h2>Processes on GPU</h2>
          <span className="hardware-panel-meta">NVIDIA-only feature</span>
        </header>
        <div className="hardware-empty">
          Per-process VRAM inspection uses <code>nvidia-smi</code>. Not available on this machine —
          Metal (Apple GPU) and AMD do not expose an equivalent API.
        </div>
      </section>
    );
  }

  const total = processes.reduce((s, p) => s + p.usedMemoryMb * 1024 * 1024, 0);

  return (
    <section className="hardware-panel">
      <header>
        <h2>Processes on GPU</h2>
        <span className="hardware-panel-meta">
          {processes.length} process{processes.length === 1 ? "" : "es"} · {bytes(total)}
        </span>
      </header>
      {processes.length === 0 ? (
        <div className="hardware-empty">No compute processes on the GPU right now.</div>
      ) : (
        <ul className="hardware-processes">
          {processes
            .slice()
            .sort((a, b) => b.usedMemoryMb - a.usedMemoryMb)
            .map((p) => (
              <li key={p.pid}>
                <span className={`hardware-process-hint hardware-process-hint--${p.providerHint}`}>
                  {PROVIDER_LABEL[p.providerHint]}
                </span>
                <code className="hardware-process-name">{p.processName}</code>
                <span className="hardware-process-pid">pid {p.pid}</span>
                <span className="hardware-process-mem">{bytes(p.usedMemoryMb * 1024 * 1024)}</span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
