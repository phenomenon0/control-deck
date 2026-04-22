/**
 * Per-process GPU-activity inspector.
 *
 * NVIDIA path (Linux/Windows): shells `nvidia-smi --query-compute-apps=...`
 * which returns the real per-process VRAM figures.
 *
 * macOS path: Metal doesn't expose per-process VRAM (no ioreg key, no
 * public API). But on Apple Silicon with unified memory, total RSS of
 * known GPU-intensive processes is the next-best proxy — if Ollama is
 * sitting at 5 GB RSS, it's effectively using 5 GB of unified memory and
 * that memory is available to the GPU. We shell `ps -A -o pid,rss,comm`
 * and filter by the same provider-hint regex used on NVIDIA.
 *
 * Both paths return the same `GpuProcess[]` shape so the UI renders
 * identically. `supported` in the API response tells the UI whether the
 * numbers are "real VRAM" (NVIDIA) vs "RSS proxy" (Mac).
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { GpuProcess, ProviderHint } from "./gpu-types";

export type { GpuProcess, ProviderHint } from "./gpu-types";
export { PROVIDER_LABEL } from "./gpu-types";

const execAsync = promisify(exec);

interface HintRule {
  hint: ProviderHint;
  patterns: RegExp[];
}

const HINT_RULES: HintRule[] = [
  { hint: "ollama", patterns: [/ollama/i] },
  { hint: "vllm", patterns: [/vllm/i] },
  { hint: "llamacpp", patterns: [/llama[\s._-]?server/i, /llama\.cpp/i, /llama-server/i, /llamafile/i] },
  { hint: "lm-studio", patterns: [/lm[\s._-]?studio/i, /lms\s/i] },
  { hint: "comfyui", patterns: [/comfy/i] },
  { hint: "whisper", patterns: [/whisper/i] },
  { hint: "piper", patterns: [/piper/i] },
  { hint: "pytorch", patterns: [/python[0-9.]*$/i, /torch/i, /pytorch/i] },
];

function inferProvider(processName: string): ProviderHint {
  for (const rule of HINT_RULES) {
    if (rule.patterns.some((re) => re.test(processName))) return rule.hint;
  }
  return "other";
}

/**
 * Returns null only when no collector works on this platform. On NVIDIA
 * the data comes from `nvidia-smi --query-compute-apps`; on macOS from
 * `ps -A` filtered by provider-name regex.
 */
export async function collectGpuProcesses(): Promise<GpuProcess[] | null> {
  // macOS path — ps + regex filter. Always supported; returns [] if no
  // known GPU-intensive processes are running.
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execAsync(
        "ps -A -o pid=,rss=,comm=",
        { timeout: 2000, maxBuffer: 2 * 1024 * 1024 },
      );
      return parsePsOutput(stdout);
    } catch {
      return [];
    }
  }

  // NVIDIA path.
  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits",
      { timeout: 2000 },
    );
    return parseNvidiaSmiOutput(stdout);
  } catch {
    return null;
  }
}

/**
 * Parse `ps -A -o pid=,rss=,comm=` output and keep only rows whose comm
 * matches a known GPU-intensive provider. RSS is reported in KB by `ps`
 * on macOS, so we divide by 1024 to MB.
 */
export function parsePsOutput(stdout: string): GpuProcess[] {
  const rows: GpuProcess[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // pid rss comm — fields are whitespace-separated; comm may contain spaces
    // but `-o comm=` strips path on BSD ps, leaving just the basename.
    const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number.parseInt(m[1], 10);
    const rssKb = Number.parseInt(m[2], 10);
    const processName = m[3].trim();
    if (!Number.isFinite(pid) || !Number.isFinite(rssKb)) continue;
    const hint = inferProvider(processName);
    if (hint === "other") continue; // filter out the long tail
    // Cap the reported memory at a sane 64 GB so weird outliers don't
    // dominate. 1 KB → MB.
    const usedMemoryMb = Math.min(Math.round(rssKb / 1024), 65_536);
    rows.push({ pid, processName, usedMemoryMb, providerHint: hint });
  }
  // Sort descending by memory — the UI also sorts, but deterministic
  // input is nicer for tests.
  rows.sort((a, b) => b.usedMemoryMb - a.usedMemoryMb);
  return rows;
}

/** Exposed for tests. */
export function parseNvidiaSmiOutput(stdout: string): GpuProcess[] {
  const rows: GpuProcess[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length < 3) continue;
    const pid = Number.parseInt(parts[0], 10);
    const processName = parts[1];
    const usedMb = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(pid) || !processName || !Number.isFinite(usedMb)) continue;
    rows.push({
      pid,
      processName,
      usedMemoryMb: usedMb,
      providerHint: inferProvider(processName),
    });
  }
  return rows;
}

