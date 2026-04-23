import { NextResponse } from "next/server";

import { getSystemProfile } from "@/lib/system/profile";
import { getInstalledOllamaModels } from "@/lib/system/detect";

export async function GET() {
  const profile = getSystemProfile();
  const installed = await getInstalledOllamaModels();
  return NextResponse.json({
    profile,
    installed,
    asOf: new Date().toISOString(),
  });
}
