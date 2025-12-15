import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface GpuStats {
  name: string;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  utilization: number;
  temperature: number;
}

interface ServiceStatus {
  name: string;
  url: string;
  status: "online" | "offline" | "unknown";
  latencyMs?: number;
}

async function getGpuStats(): Promise<GpuStats | null> {
  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits"
    );
    const parts = stdout.trim().split(", ");
    if (parts.length >= 5) {
      const memUsed = parseInt(parts[1], 10);
      const memTotal = parseInt(parts[2], 10);
      return {
        name: parts[0],
        memoryUsed: memUsed,
        memoryTotal: memTotal,
        memoryPercent: Math.round((memUsed / memTotal) * 100),
        utilization: parseInt(parts[3], 10),
        temperature: parseInt(parts[4], 10),
      };
    }
  } catch {
    // nvidia-smi not available
  }
  return null;
}

async function checkService(name: string, url: string): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    return {
      name,
      url,
      status: res.ok ? "online" : "offline",
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      name,
      url,
      status: "offline",
    };
  }
}

export async function GET() {
  const OLLAMA_URL = process.env.OLLAMA_BASE_URL?.replace("/v1", "") ?? "http://localhost:11434";
  const COMFY_URL = process.env.COMFY_URL ?? "http://localhost:8188";
  const VOICE_URL = process.env.VOICE_API_URL ?? "http://localhost:8000";

  // Check all services in parallel
  const [gpu, ollama, comfy, voice] = await Promise.all([
    getGpuStats(),
    checkService("Ollama", `${OLLAMA_URL}/api/tags`),
    checkService("ComfyUI", `${COMFY_URL}/system_stats`),
    checkService("Voice API", `${VOICE_URL}/health`),
  ]);

  return NextResponse.json({
    gpu,
    services: [ollama, comfy, voice],
    timestamp: new Date().toISOString(),
  });
}
