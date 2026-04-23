import { NextResponse } from "next/server";
import { probeHealth } from "@/lib/agentgo/launcher";

export async function GET() {
  return NextResponse.json(await probeHealth());
}
