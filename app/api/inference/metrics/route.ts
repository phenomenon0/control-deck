import { NextResponse } from "next/server";

import { getMetricsSnapshot } from "@/lib/inference/metrics";

export async function GET() {
  return NextResponse.json(getMetricsSnapshot());
}
