/**
 * Free ComfyUI GPU Memory
 * POST /api/comfy/free - Unload all models and free VRAM
 */

import { NextResponse } from "next/server";
import { freeComfyMemory, checkVRAM, checkComfyHealth } from "@/lib/tools/comfy";

export async function POST() {
  try {
    // Check if ComfyUI is running
    const healthy = await checkComfyHealth();
    if (!healthy) {
      return NextResponse.json(
        { success: false, error: "ComfyUI is not running" },
        { status: 503 }
      );
    }

    // Free memory
    const freed = await freeComfyMemory();
    
    // Check VRAM after freeing
    const vram = await checkVRAM();

    return NextResponse.json({
      success: freed,
      message: freed ? "Memory freed successfully" : "Failed to free memory",
      vram: vram ? {
        free: vram.free,
        total: vram.total,
        used: vram.used,
        freePercent: Math.round((vram.free / vram.total) * 100),
      } : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const healthy = await checkComfyHealth();
    const vram = await checkVRAM();

    return NextResponse.json({
      comfyui: healthy ? "online" : "offline",
      vram: vram ? {
        free: vram.free,
        total: vram.total,
        used: vram.used,
        freePercent: Math.round((vram.free / vram.total) * 100),
      } : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
