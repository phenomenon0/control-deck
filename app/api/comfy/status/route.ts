import { NextResponse } from "next/server";

const COMFY_URL = process.env.COMFY_URL ?? process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188";

interface ComfySystemStats {
  devices?: Array<{
    vram_free?: number;
    vram_total?: number;
  }>;
}

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch(`${COMFY_URL}/system_stats`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return NextResponse.json({ comfyui: "offline", error: `ComfyUI returned ${res.status}` }, { status: 502 });
    }

    const stats = (await res.json()) as ComfySystemStats;
    const device = stats.devices?.[0];
    const freeMb = device?.vram_free ? Math.round(device.vram_free / 1024 / 1024) : null;
    const totalMb = device?.vram_total ? Math.round(device.vram_total / 1024 / 1024) : null;
    return NextResponse.json({
      comfyui: "online",
      url: COMFY_URL,
      vram: freeMb !== null && totalMb !== null
        ? {
            free: freeMb,
            total: totalMb,
            used: Math.max(0, totalMb - freeMb),
            freePercent: Math.round((freeMb / totalMb) * 100),
          }
        : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ comfyui: "offline", error: msg }, { status: 200 });
  }
}
