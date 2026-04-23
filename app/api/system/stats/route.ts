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
  extra?: Record<string, unknown>;
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

async function checkVectorDB(url: string): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${url}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      // Health response includes: ok, total, active, deleted, collections (array), embedder, mode
      const collectionCount = Array.isArray(data.collections) 
        ? data.collections.length 
        : (typeof data.collections === "number" ? data.collections : 0);
      
      return {
        name: "VectorDB",
        url,
        status: "online",
        latencyMs: Date.now() - start,
        extra: {
          vectors: data.active ?? data.total ?? 0,
          deleted: data.deleted ?? 0,
          collections: collectionCount,
          embedder: data.embedder?.type ?? data.mode?.embedder_type ?? "unknown",
          model: data.mode?.embedder_model ?? "unknown",
          dimension: data.mode?.dimension ?? 0,
          walBytes: data.wal_bytes ?? 0,
          indexBytes: data.index_bytes ?? 0,
        },
      };
    }
    return { name: "VectorDB", url, status: "offline" };
  } catch {
    return { name: "VectorDB", url, status: "offline" };
  }
}

async function checkTerminalService(url: string): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${url}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { name: "Terminal Service", url, status: "offline" };
    }

    const data = await res.json();
    return {
      name: "Terminal Service",
      url,
      status: "online",
      latencyMs: Date.now() - start,
      extra: {
        sessions: data.sessions ?? 0,
        running: data.running ?? 0,
        host: data.host ?? "127.0.0.1",
      },
    };
  } catch {
    return { name: "Terminal Service", url, status: "offline" };
  }
}

export async function GET() {
  const OLLAMA_URL = (process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434").replace("/v1", "");
  const COMFY_URL = process.env.COMFY_URL ?? "http://localhost:8188";
  const VOICE_URL = process.env.VOICE_API_URL ?? "http://localhost:8000";
  const VECTORDB_URL = process.env.VECTORDB_URL ?? "http://localhost:4242";
  const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8888";
  const TERMINAL_SERVICE_URL = process.env.TERMINAL_SERVICE_URL ?? "http://127.0.0.1:4010";

  // Check all services in parallel
  const [gpu, ollama, comfy, voice, vectordb, searxng, terminalService] = await Promise.all([
    getGpuStats(),
    checkService("Ollama", `${OLLAMA_URL}/api/tags`),
    checkService("ComfyUI", `${COMFY_URL}/system_stats`),
    checkService("Voice API", `${VOICE_URL}/health`),
    checkVectorDB(VECTORDB_URL),
    checkService("SearxNG", `${SEARXNG_URL}/healthz`),
    checkTerminalService(TERMINAL_SERVICE_URL),
  ]);

  return NextResponse.json({
    gpu,
    services: [ollama, comfy, terminalService, vectordb, searxng, voice],
    timestamp: new Date().toISOString(),
  });
}
