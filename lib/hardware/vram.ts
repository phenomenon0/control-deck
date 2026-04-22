/**
 * VRAM preflight — "can this model fit?"
 *
 * Port of the Tauri model-tray's guard logic (see `apps/model-tray/src-tauri/src/providers.rs`
 * ~1330-1360). Two tiers:
 *   - Hard block: estimated VRAM exceeds current free VRAM.
 *   - Soft warn: would squeeze past the reserve buffer or GPU state unknown.
 *
 * The estimate formula mirrors the Rust side: `size_mb * 1.3 + 512` — the
 * 30% overhead accounts for KV cache + runtime, the 512 MB flat cost
 * covers activation memory and the container process itself.
 */

import type { GpuStats } from "@/lib/hooks/useSystemStats";

/** Tuned on NVIDIA; tune for Metal if we add first-class unified-memory support. */
const OVERHEAD_RATIO = 1.3;
const FLAT_OVERHEAD_MB = 512;

/**
 * Default VRAM reserve (MB). Pure env-or-default — no settings import.
 *
 * vram.ts is called from client components (ModelsTab) and must stay
 * dependency-clean: pulling in lib/settings/resolve transitively drags
 * better-sqlite3 + node:fs into Turbopack client bundles and blows up at
 * build time. When the caller needs a settings-aware reserve (server-side
 * helpers, settings hooks, etc.), pass the value explicitly as
 * `canFit(estimate, gpu, reserveMb)`.
 */
export function defaultReserveMb(): number {
  // `process.env` is statically inlined by Next at build time, so this is
  // safe in client code — it resolves to the empty string if unset.
  const raw = typeof process !== "undefined" ? process.env.DECK_VRAM_RESERVE_MB : undefined;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 2048;
}

/** Estimate VRAM footprint for a model given its on-disk size in bytes. */
export function estimateVramMb(sizeBytes: number): number {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return 0;
  const sizeMb = sizeBytes / (1024 * 1024);
  return Math.round(sizeMb * OVERHEAD_RATIO + FLAT_OVERHEAD_MB);
}

export type FitVerdict = "ok" | "warn" | "block" | "unknown";

export interface FitResult {
  verdict: FitVerdict;
  /** Estimated VRAM the model will need (MB). */
  estimateMb: number;
  /** Currently free VRAM (MB), derived from GpuStats. `null` if no GPU info. */
  freeMb: number | null;
  /** What's left after the model loads. Negative if over. */
  freeAfterMb: number | null;
  /** Reserve applied by this call. */
  reserveMb: number;
  /** Human-readable reason attached to the verdict. */
  reason: string;
}

/**
 * Core fit check. Call with the result of `estimateVramMb` + current GPU
 * stats from `useSystemStats`. `reserveMb` defaults to `defaultReserveMb()`
 * when omitted.
 */
export function canFit(
  estimateMb: number,
  gpu: GpuStats | null,
  reserveMb?: number,
): FitResult {
  const reserve = reserveMb ?? defaultReserveMb();

  if (!gpu || gpu.memoryTotal <= 0) {
    return {
      verdict: "unknown",
      estimateMb,
      freeMb: null,
      freeAfterMb: null,
      reserveMb: reserve,
      reason: "GPU state unavailable — estimate only",
    };
  }

  // useSystemStats reports memory values in MB (per /api/system/stats).
  const freeMb = Math.max(0, gpu.memoryTotal - gpu.memoryUsed);
  const freeAfterMb = freeMb - estimateMb;

  if (freeAfterMb < 0) {
    return {
      verdict: "block",
      estimateMb,
      freeMb,
      freeAfterMb,
      reserveMb: reserve,
      reason: `Needs ~${estimateMb} MB but only ${freeMb} MB free`,
    };
  }
  if (freeAfterMb < reserve) {
    return {
      verdict: "warn",
      estimateMb,
      freeMb,
      freeAfterMb,
      reserveMb: reserve,
      reason: `Would leave ${freeAfterMb} MB, below ${reserve} MB reserve`,
    };
  }
  return {
    verdict: "ok",
    estimateMb,
    freeMb,
    freeAfterMb,
    reserveMb: reserve,
    reason: `Fits with ${freeAfterMb} MB to spare`,
  };
}

/** Short label for UI badges. */
export function fitLabel(verdict: FitVerdict): string {
  switch (verdict) {
    case "ok":
      return "fits";
    case "warn":
      return "tight";
    case "block":
      return "too big";
    case "unknown":
      return "—";
  }
}
