import { NextResponse } from "next/server";

import {
  curatedBenchmarks,
  curatedForModality,
  getBenchmarks,
} from "@/lib/inference/benchmarks";
import { MODALITIES } from "@/lib/inference/types";
import type { Modality } from "@/lib/inference/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const modalityParam = url.searchParams.get("modality");
  const live = url.searchParams.get("live") !== "0"; // default true; pass ?live=0 to skip OpenRouter merge

  if (modalityParam) {
    if (!(modalityParam in MODALITIES)) {
      return NextResponse.json({ error: `unknown modality: ${modalityParam}` }, { status: 400 });
    }
    const modality = modalityParam as Modality;
    const entries = live ? await getBenchmarks(modality) : curatedForModality(modality);
    return NextResponse.json({ modality, entries, asOf: "2026-04" });
  }

  // No filter → return the full curated set (no live merge to keep it cheap).
  return NextResponse.json({ entries: curatedBenchmarks(), asOf: "2026-04" });
}
