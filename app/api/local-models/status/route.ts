/**
 * GET /api/local-models/status — per-modality local-first install status.
 *
 * For each modality, returns:
 *   - The recommended default at the requested preset (from local-defaults.ts)
 *   - Whether it's installed locally right now
 *   - Whether the app can pull it directly (true for Ollama tags, false for
 *     sidecar-bundled or unavailable entries)
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
 *       voiceSidecar:  { reachable, wsUrl | null },
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

const PRESETS = new Set<LocalPreset>(["quick", "balanced", "quality"]);

interface SidecarProbe {
  reachable: boolean;
  wsUrl: string | null;
}

async function probeVoiceSidecar(): Promise<SidecarProbe> {
  // voice-core speaks over WS on 4245 and exposes /health on the same port.
  // Probe /health server-side using localhost since this endpoint runs in the
  // Next server process.
  const base = process.env.VOICE_CORE_URL ?? "http://127.0.0.1:4245";
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { reachable: false, wsUrl: null };
    const wsUrl = base.replace(/^http/, "ws") + "/ws";
    return { reachable: true, wsUrl };
  } catch {
    return { reachable: false, wsUrl: null };
  }
}

function hintFor(runner: LocalRunner, installed: boolean, ollama: OllamaProbe, sidecar: SidecarProbe): string | null {
  if (installed) return null;
  switch (runner) {
    case "ollama":
      return ollama.reachable ? null : "Ollama isn't reachable. Start `ollama serve` to enable local pulls.";
    case "voice-sidecar":
      return sidecar.reachable
        ? "Bundled with the local voice service. Launch the voice sidecar to enable."
        : "voice-core isn't running on :4245. Start the voice service to enable.";
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

  const [ollama, sidecar] = await Promise.all([probeOllama(), probeVoiceSidecar()]);

  const modalities = (Object.keys(LOCAL_DEFAULTS) as Modality[]).map((m) => {
    const entry = LOCAL_DEFAULTS[m];
    const def = entry.defaults[preset];

    let installed = false;
    if (def.runner === "ollama" && def.id) {
      installed = ollamaInstalledMatch(def.id, ollama.installed);
    } else if (def.runner === "voice-sidecar" && def.id) {
      // We can't (yet) ask the sidecar "do you have this engine loaded?" —
      // treat reachable-sidecar as "bundled model is live". Until the sidecar
      // exposes a model-list endpoint, this is the best signal we have.
      installed = sidecar.reachable;
    }

    const canPull = def.runner === "ollama" && ollama.reachable;

    return {
      modality: entry.modality,
      name: entry.name,
      description: entry.description,
      default: def,
      installed,
      canPull,
      hint: hintFor(def.runner, installed, ollama, sidecar),
    };
  });

  return NextResponse.json({
    preset,
    runners: { ollama, voiceSidecar: sidecar },
    modalities,
  });
}
