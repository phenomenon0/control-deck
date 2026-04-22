"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface GpuStats {
  name: string;
  memoryUsed: number; // MiB
  memoryTotal: number; // MiB
  memoryPercent: number;
}

interface VramEstimatorProps {
  modelName: string;
  modelBytes: number;
  onClose: () => void;
}

/**
 * Rough rule-of-thumb for GGUF/AWQ-style quantized weights: loaded footprint
 * is ~1.2× the on-disk file size to cover KV cache, context buffers, and
 * CUDA overhead. Below ~4GB we pad more (fixed overhead dominates).
 */
function estimateVramGb(modelBytes: number): number {
  const gb = modelBytes / 1024 ** 3;
  if (gb < 2) return +(gb * 1.4).toFixed(2);
  if (gb < 8) return +(gb * 1.2).toFixed(2);
  return +(gb * 1.15).toFixed(2);
}

export function VramEstimator({ modelName, modelBytes, onClose }: VramEstimatorProps) {
  const [gpu, setGpu] = useState<GpuStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/system/stats");
        const data = await res.json();
        if (!cancelled) setGpu(data.gpu ?? null);
      } catch {
        if (!cancelled) setGpu(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const estimatedGb = estimateVramGb(modelBytes);
  const hasTotal = !!gpu && gpu.memoryTotal > 0;
  const freeMib = hasTotal ? gpu!.memoryTotal - gpu!.memoryUsed : 0;
  const freeGb = +(freeMib / 1024).toFixed(2);
  const totalGb = hasTotal ? +(gpu!.memoryTotal / 1024).toFixed(2) : 0;
  const fits = hasTotal ? estimatedGb <= freeGb : null;
  const usedPercent = hasTotal ? gpu!.memoryPercent : 0;
  // Cap the load bar to the remaining headroom so used + load can never
  // visually exceed 100%. The fits/insufficient label still reflects the
  // true estimate vs available.
  const rawLoadPercent = hasTotal
    ? Math.round(((estimatedGb * 1024) / gpu!.memoryTotal) * 100)
    : 0;
  const loadPercent = Math.max(0, Math.min(100 - usedPercent, rawLoadPercent));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`VRAM estimator for ${modelName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-[8px] border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div>
            <div className="text-xs text-[var(--text-muted)]">VRAM estimator</div>
            <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{modelName}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {loading ? (
            <div className="text-sm text-[var(--text-muted)]">Reading GPU stats...</div>
          ) : !hasTotal ? (
            <div className="rounded-[6px] border border-[var(--border)] p-3 text-sm">
              <div className="text-[var(--text-primary)]">No GPU detected</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                nvidia-smi didn't respond. Estimate: <span className="font-mono">{estimatedGb} GB</span> required.
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1.5">
                  <span>Estimated load</span>
                  <span className="font-mono">
                    {estimatedGb} GB / {totalGb} GB total
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-[var(--text-muted)]/40"
                    style={{ width: `${usedPercent}%` }}
                    title={`currently used: ${usedPercent}%`}
                  />
                  <div
                    className={`absolute inset-y-0 ${fits ? "bg-[var(--success)]" : "bg-[var(--error)]"}`}
                    style={{ left: `${usedPercent}%`, width: `${loadPercent}%` }}
                    title={`this model: ~${loadPercent}%`}
                  />
                </div>
                <div className="flex items-center justify-between text-xs mt-1.5">
                  <span className="text-[var(--text-muted)]">
                    Free: <span className="font-mono text-[var(--text-secondary)]">{freeGb} GB</span>
                  </span>
                  <span className={fits ? "text-[var(--success)]" : "text-[var(--error)]"}>
                    {fits ? "Fits" : "Insufficient VRAM"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[var(--text-muted)]">GPU</div>
                  <div className="text-[var(--text-primary)] truncate" title={gpu.name}>
                    {gpu.name}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Currently used</div>
                  <div className="text-[var(--text-primary)] font-mono">{usedPercent}%</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAdvanced(!advanced)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {advanced ? "Hide" : "Show"} advanced
              </button>
              {advanced && (
                <div className="text-xs text-[var(--text-muted)] space-y-1 border-t border-[var(--border)] pt-3">
                  <div>
                    Estimation: <span className="font-mono">disk_size × 1.15–1.4</span> (KV cache + context
                    overhead). Rough; actual load varies with context length, batch size, and KV quant.
                  </div>
                  <div>
                    Context length, sampler, and quantization overrides will live here once the Ollama{" "}
                    <span className="font-mono">/api/show</span> plumbing lands.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
