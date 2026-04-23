/**
 * System Detection - Hardware profiling for mode selection
 * Detects GPU, RAM, CPU to determine lite vs power mode
 */

import { execSync } from "child_process";
import os from "os";

export type DeckMode = "lite" | "power";
export type InferenceBackend = "metal" | "cuda" | "rocm" | "cpu";

export interface GpuInfo {
  name: string;
  vram: number; // MB
  /**
   * Apple Silicon unified-memory GPU: vram field carries an estimate that's
   * really a slice of system RAM. UI and fit scoring both branch on this.
   */
  unifiedMemory?: boolean;
}

export interface StorageInfo {
  freeGb: number;
  totalGb: number;
}

export interface SystemProfile {
  mode: DeckMode;
  gpu: GpuInfo | null;
  ram: number; // GB
  cpuCores: number;
  cpuModel: string;
  isIntel: boolean; // For OpenVINO optimization
  platform: NodeJS.Platform;
  /** The backend most-likely to accelerate local inference on this machine. */
  backend: InferenceBackend;
  /** Free disk space on the home volume (MB for Ollama pulls, etc.). */
  storage: StorageInfo | null;
  recommended: {
    textModel: string;
    imageBackend: "comfy";
    imageResolution: number;
  };
}

/**
 * Detect NVIDIA GPU info via nvidia-smi (Linux + Windows when driver installed)
 */
function detectNvidiaGpu(): GpuInfo | null {
  try {
    const output = execSync(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
      { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (!output) return null;

    const [name, vramStr] = output.split(",").map((s) => s.trim());
    const vram = parseInt(vramStr, 10);

    if (isNaN(vram)) return null;

    return { name, vram };
  } catch {
    return null;
  }
}

function detectMacGpu(): GpuInfo | null {
  try {
    const output = execSync("system_profiler SPDisplaysDataType -json", {
      encoding: "utf-8",
      timeout: 4000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output);
    const gpu = parsed?.SPDisplaysDataType?.[0];
    if (!gpu) return null;
    const name = gpu.sppci_model ?? gpu._name ?? "Apple GPU";
    // Apple Silicon GPUs use unified memory — report system RAM as vram.
    // Intel Macs: discrete GPU sppci_vram like "4 GB".
    let vram = 0;
    let unifiedMemory = false;
    const vramStr = gpu.sppci_vram ?? gpu.spdisplays_vram ?? "";
    const mbMatch = /(\d+)\s*MB/i.exec(vramStr);
    const gbMatch = /(\d+)\s*GB/i.exec(vramStr);
    if (mbMatch) vram = parseInt(mbMatch[1], 10);
    else if (gbMatch) vram = parseInt(gbMatch[1], 10) * 1024;
    else {
      // Apple Silicon path — unified memory. A practical inference budget is
      // ~60% of system RAM: leaving 40% for OS + app + context scratch.
      vram = Math.round((os.totalmem() / (1024 * 1024)) * 0.6);
      unifiedMemory = true;
    }
    return { name, vram, unifiedMemory };
  } catch {
    return null;
  }
}

function detectWindowsGpu(): GpuInfo | null {
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name, AdapterRAM | ConvertTo-Json -Compress"',
      { encoding: "utf-8", timeout: 4000, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (!output) return null;
    const parsed = JSON.parse(output);
    const name = parsed?.Name ?? "GPU";
    const adapterRam = Number(parsed?.AdapterRAM ?? 0);
    // AdapterRAM maxes out at 4 GB for 32-bit field; good enough for the mode decision.
    const vram = adapterRam > 0 ? Math.round(adapterRam / (1024 * 1024)) : 0;
    return { name, vram };
  } catch {
    return null;
  }
}

function detectGpu(): GpuInfo | null {
  if (process.platform === "darwin") {
    return detectMacGpu();
  }
  // Linux + Windows: try nvidia-smi first; on Windows fall back to WMI.
  const nv = detectNvidiaGpu();
  if (nv) return nv;
  if (process.platform === "win32") return detectWindowsGpu();
  return null;
}

/**
 * Get total system RAM in GB
 */
function getSystemRam(): number {
  const totalBytes = os.totalmem();
  return Math.round(totalBytes / (1024 * 1024 * 1024));
}

/**
 * Get CPU info
 */
function getCpuInfo(): { cores: number; model: string; isIntel: boolean } {
  const cpus = os.cpus();
  const model = cpus[0]?.model ?? "Unknown";
  const isIntel = model.toLowerCase().includes("intel");

  return {
    cores: cpus.length,
    model,
    isIntel,
  };
}

/**
 * Infer the preferred inference backend for this machine.
 * Heuristic: Apple Silicon → metal, NVIDIA GPU → cuda, AMD GPU detected → rocm,
 * anything else → cpu. We don't shell out for arch detection on darwin since
 * system_profiler already gave us the Apple-Silicon signal via unifiedMemory.
 */
function detectBackend(gpu: GpuInfo | null): InferenceBackend {
  if (process.platform === "darwin") {
    return gpu?.unifiedMemory ? "metal" : gpu ? "metal" : "cpu";
  }
  if (gpu) {
    const n = gpu.name.toLowerCase();
    if (n.includes("nvidia") || n.includes("geforce") || n.includes("rtx") ||
        n.includes("quadro") || n.includes("tesla") || n.includes("a100") ||
        n.includes("h100")) {
      return "cuda";
    }
    if (n.includes("amd") || n.includes("radeon")) {
      return "rocm";
    }
  }
  return "cpu";
}

/**
 * Free + total disk on the user's home volume. Used to filter out model
 * pulls that would exceed available space.
 */
function detectStorage(): StorageInfo | null {
  try {
    // `df -Pk` returns POSIX-standard 6 columns:
    //   Filesystem  1024-blocks  Used  Available  Capacity  Mounted-on
    // — consistent across darwin + linux. Wraps long filesystem names to a
    // second line only when the Filesystem is too long; -P forces one line.
    const home = os.homedir();
    const output = execSync(`df -Pk "${home}"`, {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const lines = output.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return null;
    const cols = lines[lines.length - 1].split(/\s+/);
    // POSIX layout: [fs, 1024-blocks, used, available, capacity, mount]
    const totalKb = Number(cols[1]);
    const availKb = Number(cols[3]);
    if (!Number.isFinite(availKb) || !Number.isFinite(totalKb)) return null;
    return {
      freeGb: Math.round(availKb / (1024 * 1024)),
      totalGb: Math.round(totalKb / (1024 * 1024)),
    };
  } catch {
    return null;
  }
}

/**
 * Determine recommended mode based on hardware
 */
function determineMode(gpu: GpuInfo | null, ram: number): DeckMode {
  // Check environment override first
  const envMode = process.env.CONTROL_DECK_MODE?.toLowerCase();
  if (envMode === "lite") return "lite";
  if (envMode === "power") return "power";

  // Auto-detect based on hardware
  // Power mode requires: GPU with 6GB+ VRAM AND 12GB+ system RAM
  if (gpu && gpu.vram >= 6000 && ram >= 12) {
    return "power";
  }

  // Everything else is lite mode
  return "lite";
}

/**
 * Get recommended settings based on mode
 */
function getRecommendedSettings(
  mode: DeckMode,
  gpu: GpuInfo | null
): SystemProfile["recommended"] {
  if (mode === "power" && gpu) {
    return {
      textModel: process.env.LLM_MODEL ?? "qwen2",
      imageBackend: "comfy",
      imageResolution: 768,
    };
  }

  return {
    textModel: process.env.LLM_MODEL ?? "qwen2",
    imageBackend: "comfy",
    imageResolution: 256,
  };
}

/**
 * Detect full system profile
 */
export function detectSystem(): SystemProfile {
  const gpu = detectGpu();
  const ram = getSystemRam();
  const cpu = getCpuInfo();
  const mode = determineMode(gpu, ram);
  const recommended = getRecommendedSettings(mode, gpu);
  const backend = detectBackend(gpu);
  const storage = detectStorage();

  return {
    mode,
    gpu,
    ram,
    cpuCores: cpu.cores,
    cpuModel: cpu.model,
    isIntel: cpu.isIntel,
    platform: process.platform,
    backend,
    storage,
    recommended,
  };
}

/**
 * Fetch the list of models currently installed in the user's Ollama.
 * Async + separate from detectSystem so hardware probing stays cheap.
 * Returns [] when Ollama is offline / misconfigured — non-fatal.
 */
export async function getInstalledOllamaModels(): Promise<
  Array<{ name: string; sizeBytes: number; family?: string; quantization?: string }>
> {
  const OLLAMA_URL = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434")
    .replace(/\/v1$/, "");
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{
        name: string;
        size: number;
        details?: { family?: string; quantization_level?: string };
      }>;
    };
    return (data.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      family: m.details?.family,
      quantization: m.details?.quantization_level,
    }));
  } catch {
    return [];
  }
}

/**
 * Check if we should use lite mode
 */
export function isLiteMode(): boolean {
  const profile = detectSystem();
  return profile.mode === "lite";
}

/**
 * Get the recommended text model for current mode
 */
export function getRecommendedTextModel(): string {
  const profile = detectSystem();
  return profile.recommended.textModel;
}

/**
 * Format system profile for logging/display
 */
export function formatSystemProfile(profile: SystemProfile): string {
  const lines = [
    `Mode: ${profile.mode.toUpperCase()}`,
    `Platform: ${profile.platform}`,
    `RAM: ${profile.ram}GB`,
    `CPU: ${profile.cpuModel} (${profile.cpuCores} cores)`,
  ];

  if (profile.gpu) {
    lines.push(`GPU: ${profile.gpu.name} (${Math.round(profile.gpu.vram / 1024)}GB VRAM)`);
  } else {
    lines.push("GPU: None detected");
  }

  lines.push(`Recommended text model: ${profile.recommended.textModel}`);
  lines.push(`Recommended image backend: ${profile.recommended.imageBackend}`);
  lines.push(`Recommended image resolution: ${profile.recommended.imageResolution}px`);

  return lines.join("\n");
}
