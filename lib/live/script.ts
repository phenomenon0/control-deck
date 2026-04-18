import { parsePattern, type Step } from "./mini";
import type { FxType } from "./engine";

export const LIVE_FX_TYPES = ["reverb", "delay", "chorus", "filter", "distortion"] as const;

export interface LiveFxSpec {
  type: FxType;
  wet: number;
}

export interface LiveScriptTrack {
  track: number;
  name?: string;
  pattern: string;
  steps: Step[];
}

export interface LiveScriptSample {
  track: number;
  name?: string;
  prompt: string;
  duration: number;
  seed?: number;
  loader: "stable-audio" | "ace-step";
}

export interface ParsedLiveScript {
  bpm?: number;
  tracks: LiveScriptTrack[];
  fxChains: Array<{ track: number; chain: LiveFxSpec[] }>;
  samples: LiveScriptSample[];
  errors: string[];
}

const DEFAULT_SAMPLE_DURATION = 8;
const DEFAULT_SAMPLE_LOADER: LiveScriptSample["loader"] = "stable-audio";

function isFxType(value: string): value is FxType {
  return (LIVE_FX_TYPES as readonly string[]).includes(value);
}

function readOptions(input: string): { rest: string; options: Record<string, string> } {
  const options: Record<string, string> = {};
  let rest = input;
  const optionRe = /\b([a-z_]+)=("[^"]*"|'[^']*'|[^\s]+)/gi;
  rest = rest.replace(optionRe, (_match, key: string, rawValue: string) => {
    const value = rawValue.replace(/^["']|["']$/g, "");
    options[key.toLowerCase()] = value;
    return "";
  });
  return { rest: rest.trim(), options };
}

function parseFxChain(raw: string): LiveFxSpec[] {
  return raw
    .split(/[>,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([a-z-]+)(?:\s*\(\s*([0-9.]+)\s*\)|\s+([0-9.]+))?$/i);
      if (!match) throw new Error(`Invalid FX token "${part}"`);
      const type = match[1].toLowerCase();
      if (!isFxType(type)) throw new Error(`Unknown FX "${type}"`);
      const wet = Number(match[2] ?? match[3] ?? 0.4);
      return {
        type,
        wet: Number.isFinite(wet) ? Math.max(0, Math.min(1, wet)) : 0.4,
      };
    });
}

function parseSample(track: number, name: string | undefined, raw: string): LiveScriptSample {
  const { rest, options } = readOptions(raw);
  const duration = Number(options.duration ?? options.seconds ?? DEFAULT_SAMPLE_DURATION);
  const seed = options.seed !== undefined ? Number(options.seed) : undefined;
  const loader = options.loader === "ace-step" ? "ace-step" : DEFAULT_SAMPLE_LOADER;
  const prompt = (options.prompt ?? rest).trim();
  if (!prompt) throw new Error(`Sample ${track} needs a prompt`);
  return {
    track,
    name: name?.trim() || undefined,
    prompt,
    duration: Number.isFinite(duration) ? Math.max(1, Math.min(47, duration)) : DEFAULT_SAMPLE_DURATION,
    seed: Number.isFinite(seed) ? seed : undefined,
    loader,
  };
}

function readTrack(raw: string): number {
  const track = Number(raw);
  if (!Number.isInteger(track) || track < 0 || track > 7) {
    throw new Error(`Track ${raw} must be 0-7`);
  }
  return track;
}

export function parseLiveScript(source: string): ParsedLiveScript {
  const parsed: ParsedLiveScript = { tracks: [], fxChains: [], samples: [], errors: [] };
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("//")) continue;

    try {
      const bpmMatch = raw.match(/^bpm\s+([0-9.]+)$/i);
      if (bpmMatch) {
        const bpm = Number(bpmMatch[1]);
        if (Number.isFinite(bpm)) parsed.bpm = Math.max(40, Math.min(300, bpm));
        continue;
      }

      const fxMatch = raw.match(/^fx\s+(\d+)\s*:\s*(.+)$/i);
      if (fxMatch) {
        parsed.fxChains.push({
          track: readTrack(fxMatch[1]),
          chain: parseFxChain(fxMatch[2]),
        });
        continue;
      }

      const sampleMatch = raw.match(/^sample\s+(\d+)(?:\s+([A-Za-z0-9 _-]{1,32}))?\s*:\s*(.+)$/i);
      if (sampleMatch) {
        parsed.samples.push(parseSample(readTrack(sampleMatch[1]), sampleMatch[2], sampleMatch[3]));
        continue;
      }

      const trackMatch = raw.match(/^(\d+)(?:\s+([A-Za-z0-9 _-]{1,32}))?\s*:\s*(.*)$/);
      if (trackMatch) {
        parsed.tracks.push({
          track: readTrack(trackMatch[1]),
          name: trackMatch[2]?.trim() || undefined,
          pattern: trackMatch[3],
          steps: parsePattern(trackMatch[3]),
        });
        continue;
      }
    } catch (error) {
      parsed.errors.push(`Line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    parsed.errors.push(`Line ${i + 1}: ignored "${raw}"`);
  }

  return parsed;
}
