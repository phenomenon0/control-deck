/**
 * AMD GPU collector — `rocm-smi` on Linux.
 *
 * ROCm is AMD's CUDA equivalent. The bundled `rocm-smi` tool exposes
 * per-card utilisation, VRAM, and temperature in JSON when called with
 * `--json`. We match that against our common `GpuStats`-like shape.
 *
 * Windows AMD users: AMD Software Adrenalin doesn't ship a CLI equivalent
 * in 2026 — we fall through to `wmic` for static info only. That's
 * handled in `collectWindowsGpu`, not here.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface AmdGpuStats {
  name: string;
  /** GPU utilisation %. */
  utilization: number;
  /** VRAM used in MB. */
  memoryUsedMb: number;
  /** VRAM total in MB. */
  memoryTotalMb: number;
  memoryPercent: number;
  /** Edge temperature °C (the metric AMD surfaces in rocm-smi). */
  temperatureC: number;
}

/**
 * Returns the first ROCm card found, or null when rocm-smi isn't on PATH
 * / no AMD GPU detected. Multi-GPU reporting is out of scope for v1.
 */
export async function collectAmdGpu(): Promise<AmdGpuStats | null> {
  // rocm-smi is Linux-only — AMD on Windows uses a GUI-only stack.
  if (process.platform !== "linux") return null;
  try {
    const { stdout } = await execAsync(
      "rocm-smi --showuse --showmeminfo vram --showtemp --showproductname --json",
      { timeout: 3000, maxBuffer: 1024 * 1024 },
    );
    return parseRocmSmi(stdout);
  } catch {
    return null;
  }
}

interface RocmCard {
  "GPU use (%)"?: string;
  "VRAM Total Memory (B)"?: string;
  "VRAM Total Used Memory (B)"?: string;
  "Temperature (Sensor edge) (C)"?: string;
  "Card series"?: string;
  "Card model"?: string;
  "Card vendor"?: string;
}

/** Exposed for tests. */
export function parseRocmSmi(stdout: string): AmdGpuStats | null {
  let parsed: Record<string, RocmCard>;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  // rocm-smi keys by "card0", "card1"… We take the first.
  const cardKey = Object.keys(parsed).find((k) => k.startsWith("card"));
  if (!cardKey) return null;
  const card = parsed[cardKey];

  const util = Number.parseInt(card["GPU use (%)"] ?? "0", 10);
  const totalBytes = Number.parseInt(card["VRAM Total Memory (B)"] ?? "0", 10);
  const usedBytes = Number.parseInt(card["VRAM Total Used Memory (B)"] ?? "0", 10);
  const temp = Number.parseFloat(card["Temperature (Sensor edge) (C)"] ?? "0");
  const name = card["Card series"] ?? card["Card model"] ?? "AMD GPU";

  const totalMb = Math.round(totalBytes / (1024 * 1024));
  const usedMb = Math.round(usedBytes / (1024 * 1024));
  const pct = totalMb > 0 ? (usedMb / totalMb) * 100 : 0;

  return {
    name,
    utilization: Number.isFinite(util) ? util : 0,
    memoryUsedMb: usedMb,
    memoryTotalMb: totalMb,
    memoryPercent: Math.round(pct * 10) / 10,
    temperatureC: Number.isFinite(temp) ? Math.round(temp) : 0,
  };
}
