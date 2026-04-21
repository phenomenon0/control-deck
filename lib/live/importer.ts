/**
 * Script → Song importer.
 *
 * Takes a parsed Live script (the legacy text DSL) and applies it to a
 * SongStore as a fresh FL-native arrangement:
 *   - one Channel per track number present in the script
 *   - one Pattern "main" holding every track's step slice
 *   - one PatternClip on lane 0 so playback has something to fire
 *   - one Insert per track that had an FX chain, routed from the channel,
 *     with built-in FX specs stamped in
 *   - one AudioClip per `sample N ...` line (in pending state, audio renders
 *     asynchronously via /api/live/sample)
 *
 * The script parser itself (lib/live/script.ts) is unchanged — this importer
 * just consumes its output.
 */

import { createSong, newId, type ChannelKind, type UUID } from "./model";
import { parseLiveScript } from "./script";
import { SongStore } from "./store";

export interface ImportResult {
  patternId: UUID;
  channelIds: Record<number, UUID>;
  insertIds: Record<number, UUID>;
  audioClipIds: Record<number, UUID>;
  errors: string[];
}

export function importLiveScript(store: SongStore, source: string): ImportResult {
  const parsed = parseLiveScript(source);

  store.replace(createSong("Imported from script"));
  if (parsed.bpm) store.setBpm(parsed.bpm);

  const bpm = parsed.bpm ?? store.getSong().bpm;

  const kindByTrack: Record<number, ChannelKind> = {};
  const nameByTrack: Record<number, string> = {};

  for (const t of parsed.tracks) {
    kindByTrack[t.track] = guessKind(t.track, t.steps);
    nameByTrack[t.track] = t.name ?? defaultTrackName(t.track);
  }
  for (const s of parsed.samples) {
    kindByTrack[s.track] = "sampler";
    nameByTrack[s.track] = s.name ?? `sample${s.track}`;
  }

  const channelIds: Record<number, UUID> = {};
  const orderedTracks = Object.keys(kindByTrack).map(Number).sort((a, b) => a - b);
  for (const tn of orderedTracks) {
    channelIds[tn] = store.addChannel(kindByTrack[tn], nameByTrack[tn]);
  }

  const patternId = store.addPattern("main");
  let maxSteps = 0;
  for (const t of parsed.tracks) {
    const chId = channelIds[t.track];
    if (!chId) continue;
    store.setPatternSlice(patternId, chId, t.steps);
    if (t.steps.length > maxSteps) maxSteps = t.steps.length;
  }

  if (maxSteps > 16) {
    const lengthBars = Math.max(1, Math.ceil(maxSteps / 16));
    store.patchPattern(patternId, { lengthBars });
  }

  const patternLen = store.getSong().patterns.find((p) => p.id === patternId)?.lengthBars ?? 1;
  store.addPatternClip(patternId, 0, 0, Math.max(4, patternLen * 4), "main x4");

  const insertIds: Record<number, UUID> = {};
  for (const fc of parsed.fxChains) {
    const chId = channelIds[fc.track];
    if (!chId) continue;
    const insertId = store.addInsert(`${nameByTrack[fc.track] ?? fc.track}.fx`);
    for (const fx of fc.chain) {
      store.addFx(insertId, {
        id: newId(),
        pluginUri: `builtin:${fx.type}`,
        params: {},
        wet: fx.wet,
        bypassed: false,
      });
    }
    store.routeChannelToInsert(chId, insertId);
    insertIds[fc.track] = insertId;
  }

  const audioClipIds: Record<number, UUID> = {};
  let audioLane = Math.max(1, orderedTracks.length);
  for (const s of parsed.samples) {
    const lengthBars = secondsToBars(s.duration, bpm, 4);
    const clipId = store.addAudioClip({
      name: s.name,
      lane: audioLane,
      startBar: 0,
      lengthBars,
      muted: false,
      generation: {
        prompt: s.prompt,
        duration: s.duration,
        seed: s.seed,
        loader: s.loader,
        status: "pending",
      },
    });
    audioClipIds[s.track] = clipId;
    audioLane++;
  }

  return {
    patternId,
    channelIds,
    insertIds,
    audioClipIds,
    errors: [...parsed.errors],
  };
}

function guessKind(track: number, _steps: readonly unknown[]): ChannelKind {
  if (track < 3) return "drum";
  return "synth";
}

function defaultTrackName(track: number): string {
  if (track === 0) return "kick";
  if (track === 1) return "snare";
  if (track === 2) return "hat";
  if (track === 3) return "bass";
  return `t${track}`;
}

function secondsToBars(seconds: number, bpm: number, beatsPerBar: number): number {
  const secondsPerBar = (60 / bpm) * beatsPerBar;
  return Math.max(1, Math.ceil(seconds / secondsPerBar));
}
