/**
 * SongStore — observable mutations over the Song model.
 *
 * Single source of truth for the Live surface. Platform-neutral (no Web Audio,
 * no React) so the store can be driven from UI, the Tone scheduler (Phase 2),
 * chat-dispatched agent calls, and test fixtures alike.
 *
 * Mutations produce a fresh Song object via `mutate()` so React consumers can
 * diff by identity.
 */

import {
  createAudioClip,
  createChannel,
  createFxSpec,
  createInsert,
  createLaunchGroup,
  createPattern,
  createPatternClip,
  createSong,
  type AudioClip,
  type Channel,
  type ChannelKind,
  type CreateAudioClipOpts,
  type FxSpec,
  type Insert,
  type LaunchGroup,
  type LaunchQuantize,
  type LaunchTrigger,
  type Pattern,
  type PatternClip,
  type PlaylistClip,
  type Song,
  type StepDiv,
  type UUID,
} from "./model";
import type { Step } from "./mini";

type Listener = (song: Song) => void;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export class SongStore {
  private song: Song;
  private listeners = new Set<Listener>();

  constructor(initial?: Song) {
    this.song = initial ?? createSong();
  }

  // ─── subscription / snapshot ─────────────────────────────────────────────

  getSong(): Song {
    return this.song;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.song);
    return () => { this.listeners.delete(fn); };
  }

  replace(song: Song): void {
    this.song = { ...song, updatedAt: Date.now() };
    this.emit();
  }

  // ─── transport ───────────────────────────────────────────────────────────

  setBpm(bpm: number): void {
    this.mutate((s) => ({ ...s, bpm: clamp(bpm, 40, 300) }));
  }

  setMasterGainDb(db: number): void {
    this.mutate((s) => ({ ...s, masterGainDb: clamp(db, -60, 6) }));
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.mutate((s) => ({ ...s, name: trimmed }));
  }

  // ─── channels ────────────────────────────────────────────────────────────

  addChannel(kind: ChannelKind, name?: string): UUID {
    const ch = createChannel(kind, name);
    this.mutate((s) => ({ ...s, channels: [...s.channels, ch] }));
    return ch.id;
  }

  removeChannel(id: UUID): void {
    this.mutate((s) => ({
      ...s,
      channels: s.channels.filter((c) => c.id !== id),
      patterns: s.patterns.map((p) => {
        if (!(id in p.slices)) return p;
        const nextSlices = { ...p.slices };
        delete nextSlices[id];
        return { ...p, slices: nextSlices };
      }),
    }));
  }

  patchChannel(id: UUID, patch: Partial<Omit<Channel, "id">>): void {
    this.mutate((s) => ({
      ...s,
      channels: s.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  // ─── patterns ────────────────────────────────────────────────────────────

  addPattern(name?: string, lengthBars = 1, stepDiv: StepDiv = "16n"): UUID {
    const resolvedName = name ?? `Pattern ${this.song.patterns.length + 1}`;
    const p = createPattern(resolvedName, lengthBars, stepDiv);
    this.mutate((s) => ({ ...s, patterns: [...s.patterns, p] }));
    return p.id;
  }

  removePattern(id: UUID): void {
    this.mutate((s) => ({
      ...s,
      patterns: s.patterns.filter((p) => p.id !== id),
      playlist: {
        ...s.playlist,
        clips: s.playlist.clips.filter(
          (c) => c.kind !== "pattern" || c.patternId !== id,
        ),
      },
      launchGroups: s.launchGroups.map((g) => ({
        ...g,
        triggers: g.triggers.filter(
          (t) => !(t.kind === "pattern" && t.patternId === id),
        ),
      })),
    }));
  }

  renamePattern(id: UUID, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.mutate((s) => ({
      ...s,
      patterns: s.patterns.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    }));
  }

  patchPattern(id: UUID, patch: Partial<Omit<Pattern, "id" | "slices">>): void {
    this.mutate((s) => ({
      ...s,
      patterns: s.patterns.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }

  setPatternSlice(patternId: UUID, channelId: UUID, steps: Step[]): void {
    this.mutate((s) => ({
      ...s,
      patterns: s.patterns.map((p) => {
        if (p.id !== patternId) return p;
        return {
          ...p,
          slices: { ...p.slices, [channelId]: { channelId, steps: [...steps] } },
        };
      }),
    }));
  }

  clearPatternSlice(patternId: UUID, channelId: UUID): void {
    this.mutate((s) => ({
      ...s,
      patterns: s.patterns.map((p) => {
        if (p.id !== patternId || !(channelId in p.slices)) return p;
        const nextSlices = { ...p.slices };
        delete nextSlices[channelId];
        return { ...p, slices: nextSlices };
      }),
    }));
  }

  // ─── playlist clips ──────────────────────────────────────────────────────

  addPatternClip(patternId: UUID, lane: number, startBar: number, lengthBars: number, name?: string): UUID {
    if (!this.song.patterns.some((p) => p.id === patternId)) {
      throw new Error(`Pattern ${patternId} does not exist`);
    }
    const clip = createPatternClip({ patternId, lane, startBar, lengthBars, name });
    this.mutate((s) => ({
      ...s,
      playlist: {
        ...s.playlist,
        clips: [...s.playlist.clips, clip],
        laneCount: Math.max(s.playlist.laneCount, lane + 1),
      },
    }));
    return clip.id;
  }

  addAudioClip(opts: CreateAudioClipOpts): UUID {
    const clip = createAudioClip(opts);
    this.mutate((s) => ({
      ...s,
      playlist: {
        ...s.playlist,
        clips: [...s.playlist.clips, clip],
        laneCount: Math.max(s.playlist.laneCount, opts.lane + 1),
      },
    }));
    return clip.id;
  }

  moveClip(id: UUID, lane: number, startBar: number): void {
    this.mutate((s) => ({
      ...s,
      playlist: {
        ...s.playlist,
        clips: s.playlist.clips.map((c) =>
          c.id === id ? { ...c, lane, startBar: Math.max(0, startBar) } as PlaylistClip : c,
        ),
        laneCount: Math.max(s.playlist.laneCount, lane + 1),
      },
    }));
  }

  resizeClip(id: UUID, lengthBars: number): void {
    const len = Math.max(0.0625, lengthBars);
    this.mutate((s) => ({
      ...s,
      playlist: {
        ...s.playlist,
        clips: s.playlist.clips.map((c) =>
          c.id === id ? ({ ...c, lengthBars: len } as PlaylistClip) : c,
        ),
      },
    }));
  }

  patchClip(id: UUID, patch: Partial<Omit<PatternClip, "id" | "kind">> & Partial<Omit<AudioClip, "id" | "kind">>): void {
    this.mutate((s) => ({
      ...s,
      playlist: {
        ...s.playlist,
        clips: s.playlist.clips.map((c) =>
          c.id === id ? ({ ...c, ...patch } as PlaylistClip) : c,
        ),
      },
    }));
  }

  removeClip(id: UUID): void {
    this.mutate((s) => ({
      ...s,
      playlist: { ...s.playlist, clips: s.playlist.clips.filter((c) => c.id !== id) },
      launchGroups: s.launchGroups.map((g) => ({
        ...g,
        triggers: g.triggers.filter((t) => !(t.kind === "audio" && t.clipId === id)),
      })),
    }));
  }

  // ─── mixer inserts ───────────────────────────────────────────────────────

  addInsert(name?: string): UUID {
    const insert = createInsert(name ?? `Insert ${this.song.mixer.length + 1}`);
    this.mutate((s) => ({ ...s, mixer: [...s.mixer, insert] }));
    return insert.id;
  }

  removeInsert(id: UUID): void {
    this.mutate((s) => ({
      ...s,
      mixer: s.mixer.filter((i) => i.id !== id),
      channels: s.channels.map((c) => (c.insertId === id ? { ...c, insertId: null } : c)),
    }));
  }

  patchInsert(id: UUID, patch: Partial<Omit<Insert, "id" | "fx">>): void {
    this.mutate((s) => ({
      ...s,
      mixer: s.mixer.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  }

  routeChannelToInsert(channelId: UUID, insertId: UUID | null): void {
    if (insertId !== null && !this.song.mixer.some((i) => i.id === insertId)) {
      throw new Error(`Insert ${insertId} does not exist`);
    }
    this.patchChannel(channelId, { insertId });
  }

  addFx(insertId: UUID, spec: FxSpec): void {
    this.mutate((s) => ({
      ...s,
      mixer: s.mixer.map((i) =>
        i.id === insertId ? { ...i, fx: [...i.fx, spec] } : i,
      ),
    }));
  }

  addBuiltinFx(insertId: UUID, type: string, wet = 1): UUID {
    const spec = createFxSpec(`builtin:${type}`, {}, wet);
    this.addFx(insertId, spec);
    return spec.id;
  }

  removeFx(insertId: UUID, fxId: UUID): void {
    this.mutate((s) => ({
      ...s,
      mixer: s.mixer.map((i) =>
        i.id === insertId ? { ...i, fx: i.fx.filter((f) => f.id !== fxId) } : i,
      ),
    }));
  }

  setFxWet(insertId: UUID, fxId: UUID, wet: number): void {
    const w = clamp(wet, 0, 1);
    this.mutate((s) => ({
      ...s,
      mixer: s.mixer.map((i) => {
        if (i.id !== insertId) return i;
        return { ...i, fx: i.fx.map((f) => (f.id === fxId ? { ...f, wet: w } : f)) };
      }),
    }));
  }

  setFxParam(insertId: UUID, fxId: UUID, param: string, value: number): void {
    this.mutate((s) => ({
      ...s,
      mixer: s.mixer.map((i) => {
        if (i.id !== insertId) return i;
        return {
          ...i,
          fx: i.fx.map((f) =>
            f.id === fxId ? { ...f, params: { ...f.params, [param]: value } } : f,
          ),
        };
      }),
    }));
  }

  setFxBypass(insertId: UUID, fxId: UUID, bypassed: boolean): void {
    this.mutate((s) => ({
      ...s,
      mixer: s.mixer.map((i) => {
        if (i.id !== insertId) return i;
        return { ...i, fx: i.fx.map((f) => (f.id === fxId ? { ...f, bypassed } : f)) };
      }),
    }));
  }

  // ─── launch groups ───────────────────────────────────────────────────────

  addLaunchGroup(name?: string, quantize: LaunchQuantize = "bar"): UUID {
    const g = createLaunchGroup(name ?? `Scene ${this.song.launchGroups.length + 1}`, quantize);
    this.mutate((s) => ({ ...s, launchGroups: [...s.launchGroups, g] }));
    return g.id;
  }

  removeLaunchGroup(id: UUID): void {
    this.mutate((s) => ({ ...s, launchGroups: s.launchGroups.filter((g) => g.id !== id) }));
  }

  addLaunchTrigger(groupId: UUID, trigger: LaunchTrigger): void {
    this.mutate((s) => ({
      ...s,
      launchGroups: s.launchGroups.map((g) =>
        g.id === groupId ? { ...g, triggers: [...g.triggers, trigger] } : g,
      ),
    }));
  }

  removeLaunchTrigger(groupId: UUID, index: number): void {
    this.mutate((s) => ({
      ...s,
      launchGroups: s.launchGroups.map((g) => {
        if (g.id !== groupId) return g;
        return { ...g, triggers: g.triggers.filter((_, i) => i !== index) };
      }),
    }));
  }

  patchLaunchGroup(id: UUID, patch: Partial<Omit<LaunchGroup, "id" | "triggers">>): void {
    this.mutate((s) => ({
      ...s,
      launchGroups: s.launchGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private mutate(fn: (s: Song) => Song): void {
    this.song = { ...fn(this.song), updatedAt: Date.now() };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.song);
  }
}

let _singleton: SongStore | null = null;

export function getSongStore(): SongStore {
  if (!_singleton) _singleton = new SongStore();
  return _singleton;
}

/** Reset the singleton. Used by tests and by the script importer. */
export function resetSongStore(song?: Song): SongStore {
  const store = getSongStore();
  store.replace(song ?? createSong());
  return store;
}
