/**
 * GET /api/local-models/status — per-modality local-first install status.
 *
 * For each modality, returns:
 *   - The recommended default at the requested preset (from local-defaults.ts)
 *   - Whether it's installed locally right now
 *   - Whether the app can pull it directly (true for Ollama tags, false for
 *     s2s-bundled or unavailable entries)
 *   - Per-runner availability info the UI can use to show actionable hints
 *
 * Query params:
 *   preset = quick | balanced | quality   (default: balanced)
 *
 * Response:
 *   {
 *     preset,
 *     runners: {
 *       ollama:        { reachable, installed: string[] },
 *       s2s:           { reachable, wsUrl | null, baseUrl, labUrl, labReachable },
 *     },
 *     modalities: [
 *       {
 *         modality, name, description,
 *         default: { runner, id, label, sizeMb, expectedP50Ms, note },
 *         installed: boolean,
 *         canPull: boolean,     // app can trigger the install
 *         hint: string | null,  // user-facing reason the pull button is hidden
 *       },
 *       ...
 *     ]
 *   }
 */

import { NextResponse } from "next/server";

import {
  LOCAL_DEFAULTS,
  type LocalPreset,
  type LocalRunner,
} from "@/lib/inference/local-defaults";
import {
  isOllamaInstalled as ollamaInstalledMatch,
  probeOllama,
  type OllamaProbe,
} from "@/lib/inference/ollama-probe";
import type { Modality } from "@/lib/inference/types";
import { s2sLabUrl, s2sRealtimeWsUrl, s2sUrl } from "@/lib/voice/s2s-url";

const PRESETS = new Set<LocalPreset>(["quick", "balanced", "quality"]);

interface S2sProbe {
  reachable: boolean;
  wsUrl: string | null;
  baseUrl: string;
  labUrl: string;
  labReachable: boolean;
}

async function probeS2sVoice(): Promise<S2sProbe> {
  const base = s2sUrl().replace(/\/+$/, "");
  const lab = s2sLabUrl().replace(/\/+$/, "");
  let poolReachable = false;
  let labReachable = false;
  try {
    const res = await fetch(`${base}/v1/pool`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    poolReachable = res.ok;
  } catch {
    poolReachable = false;
  }
  try {
    const res = await fetch(`${lab}/v1/voice-lab/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    labReachable = res.ok;
  } catch {
    labReachable = false;
  }
  return {
    reachable: poolReachable,
    wsUrl: poolReachable ? s2sRealtimeWsUrl() : null,
    baseUrl: base,
    labUrl: lab,
    labReachable,
  };
}

function hintFor(runner: LocalRunner, installed: boolean, ollama: OllamaProbe, voice: S2sProbe): string | null {
  if (installed) return null;
  switch (runner) {
    case "ollama":
      return ollama.reachable ? null : "Ollama isn't reachable. Start `ollama serve` to enable local pulls.";
    case "s2s":
      return voice.reachable
        ? "Local voice is served by s2s realtime."
        : "s2s local voice is not running. Start the s2s supervisor or Voice Lab to enable.";
    case "unavailable":
      return "No local runner wired up yet. Cloud providers still work for this modality.";
    default:
      return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const presetParam = url.searchParams.get("preset");
  const preset: LocalPreset = presetParam && PRESETS.has(presetParam as LocalPreset)
    ? (presetParam as LocalPreset)
    : "balanced";

  const [ollama, voice] = await Promise.all([probeOllama(), probeS2sVoice()]);

  const modalities = (Object.keys(LOCAL_DEFAULTS) as Modality[]).map((m) => {
    const entry = LOCAL_DEFAULTS[m];
    const def = entry.defaults[preset];

    let installed = false;
    if (def.runner === "ollama" && def.id) {
      installed = ollamaInstalledMatch(def.id, ollama.installed);
    } else if (def.runner === "s2s" && def.id) {
      installed = voice.reachable;
    }

    const canPull = def.runner === "ollama" && ollama.reachable;

    return {
      modality: entry.modality,
      name: entry.name,
      description: entry.description,
      default: def,
      installed,
      canPull,
      hint: hintFor(def.runner, installed, ollama, voice),
    };
  });

  return NextResponse.json({
    preset,
    runners: { ollama, s2s: voice },
    modalities,
  });
}
