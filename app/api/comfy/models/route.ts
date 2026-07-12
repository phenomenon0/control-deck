import { NextResponse } from "next/server";
import { getImageModelAvailability } from "@/lib/tools/comfyModels";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getImageModelAvailability());
  } catch {
    return NextResponse.json({ online: false, presets: {} });
  }
}
