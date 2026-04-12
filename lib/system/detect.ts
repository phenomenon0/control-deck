/**
 * System Detection - Hardware profiling for mode selection
 * Detects GPU, RAM, CPU to determine lite vs power mode
 */

import { execSync } from "child_process";
import os from "os";

export type DeckMode = "lite" | "power";

export interface GpuInfo {
  name: string;
  vram: number; // MB
}

export interface SystemProfile {
  mode: DeckMode;
  gpu: GpuInfo | null;
  ram: number; // GB
  cpuCores: number;
  cpuModel: string;
  isIntel: boolean; // For OpenVINO optimization
  platform: NodeJS.Platform;
  recommended: {
    textModel: string;
    imageBackend: "comfy" | "lite";
    imageResolution: number;
  };
}

/**
 * Detect NVIDIA GPU info
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
    imageBackend: "lite",
    imageResolution: 256,
  };
}

/**
 * Detect full system profile
 */
export function detectSystem(): SystemProfile {
  const gpu = detectNvidiaGpu();
  const ram = getSystemRam();
  const cpu = getCpuInfo();
  const mode = determineMode(gpu, ram);
  const recommended = getRecommendedSettings(mode, gpu);

  return {
    mode,
    gpu,
    ram,
    cpuCores: cpu.cores,
    cpuModel: cpu.model,
    isIntel: cpu.isIntel,
    platform: process.platform,
    recommended,
  };
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
 * Get the recommended image backend for current mode
 */
export function getRecommendedImageBackend(): "comfy" | "lite" {
  const profile = detectSystem();
  return profile.recommended.imageBackend;
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
