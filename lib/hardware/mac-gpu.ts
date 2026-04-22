/**
 * Apple Silicon GPU collector — no sudo required.
 *
 * `ioreg -r -c IOAccelerator -w0` exposes real live metrics from the AGX
 * driver on M1/M2/M3/M4:
 *   - "Device Utilization %"       — overall GPU utilisation
 *   - "Renderer Utilization %"     — 3D / compute renderer share
 *   - "Tiler Utilization %"        — tile-based deferred rendering share
 *   - "In use system memory"       — bytes currently resident in unified mem
 *   - "Alloc system memory"        — total bytes allocated (incl. cached)
 *
 * Unified memory means GPU bytes ≈ the "VRAM" concept on NVIDIA. We scale
 * total against a 60 % share of system RAM to match the existing convention
 * in `lib/system/detect.ts` (`detectMacGpu`).
 *
 * Falls back to null when `ioreg` isn't on PATH (e.g. Linux dev container).
 */

import { exec } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { collectPowermetrics } from "./mac-powermetrics";

const execAsync = promisify(exec);

export interface MacGpuStats {
  name: string;
  /** Live utilisation %. */
  utilization: number;
  rendererUtilization: number;
  tilerUtilization: number;
  /** MB currently resident. */
  memoryUsedMb: number;
  /** MB allocated (includes cached allocations). */
  memoryAllocMb: number;
  /** MB available to the GPU (60 % of unified RAM — matches detect.ts). */
  memoryTotalMb: number;
  memoryPercent: number;
  /** GPU die temp in °C when powermetrics is enabled. */
  temperatureC?: number;
  /** GPU power in milliwatts when powermetrics is enabled. */
  powerMw?: number;
}

export async function collectMacGpu(): Promise<MacGpuStats | null> {
  if (process.platform !== "darwin") return null;
  try {
    // Fan ioreg + optional powermetrics in parallel. ioreg is fast (<50ms);
    // powermetrics is ~500ms, so this keeps the combined latency flat.
    const [ioregResult, powerResult] = await Promise.all([
      execAsync("ioreg -r -c IOAccelerator -w0", {
        timeout: 2000,
        maxBuffer: 2 * 1024 * 1024,
      }).catch(() => null),
      collectPowermetricsIfEnabled(),
    ]);

    if (!ioregResult) return null;
    const parsed = parseIoreg(ioregResult.stdout);
    if (!parsed) return null;

    // Unified memory total: 60 % of system RAM, matching the GpuInfo estimate
    // in detect.ts. Bytes → MB.
    const totalRamMb = Math.round(os.totalmem() / (1024 * 1024));
    const memoryTotalMb = Math.round(totalRamMb * 0.6);
    const memoryUsedMb = Math.round(parsed.inUseBytes / (1024 * 1024));
    const memoryAllocMb = Math.round(parsed.allocBytes / (1024 * 1024));
    const memoryPercent = memoryTotalMb > 0
      ? Math.max(0, Math.min(100, (memoryUsedMb / memoryTotalMb) * 100))
      : 0;

    return {
      name: parsed.name,
      utilization: parsed.utilization,
      rendererUtilization: parsed.renderer,
      tilerUtilization: parsed.tiler,
      memoryUsedMb,
      memoryAllocMb,
      memoryTotalMb,
      memoryPercent: Math.round(memoryPercent * 10) / 10,
      temperatureC: powerResult?.gpuTempC,
      powerMw: powerResult?.gpuPowerMw,
    };
  } catch {
    return null;
  }
}

/**
 * Read settings.hardware.powermetricsEnabled and run the collector when on.
 * Falls silent on any error so `collectMacGpu` never fails because of power
 * collection issues.
 */
async function collectPowermetricsIfEnabled() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSection } = require("@/lib/settings/resolve") as typeof import("@/lib/settings/resolve");
    const hw = resolveSection("hardware");
    if (!hw.powermetricsEnabled) return null;
    return await collectPowermetrics();
  } catch {
    return null;
  }
}

interface ParsedIoreg {
  name: string;
  utilization: number;
  renderer: number;
  tiler: number;
  inUseBytes: number;
  allocBytes: number;
}

/** Exposed for tests. */
export function parseIoreg(stdout: string): ParsedIoreg | null {
  // IOClass like "AGXAcceleratorG15G" — strip the prefix for a clean name.
  const classMatch = stdout.match(/"IOClass"\s*=\s*"(AGXAccelerator[^"]*)"/);
  const name = classMatch ? classMatch[1].replace(/^AGXAccelerator/, "Apple ") : "Apple GPU";

  // Perf block is one line with comma-separated "key"=value pairs.
  const util = matchPct(stdout, "Device Utilization %");
  const renderer = matchPct(stdout, "Renderer Utilization %");
  const tiler = matchPct(stdout, "Tiler Utilization %");
  const inUse = matchNum(stdout, "In use system memory");
  const alloc = matchNum(stdout, "Alloc system memory");

  if (util === null) return null;

  return {
    name,
    utilization: util,
    renderer: renderer ?? 0,
    tiler: tiler ?? 0,
    inUseBytes: inUse ?? 0,
    allocBytes: alloc ?? 0,
  };
}

function matchPct(src: string, key: string): number | null {
  const re = new RegExp(`"${escape(key)}"\\s*=\\s*(\\d+)`);
  const m = src.match(re);
  return m ? Number.parseInt(m[1], 10) : null;
}

function matchNum(src: string, key: string): number | null {
  const re = new RegExp(`"${escape(key)}"\\s*=\\s*(\\d+)`);
  const m = src.match(re);
  return m ? Number.parseInt(m[1], 10) : null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
