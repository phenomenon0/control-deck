"use client";

/**
 * LiveTransport — Tone-based scheduler driven by SongStore.
 *
 * Subscribes to the store. Every time the Song changes, diffs against the
 * previous snapshot and applies only what's needed:
 *   - scalar transport state (bpm, master gain) → Tone params
 *   - channels → per-channel Voice (drum/synth/sampler/piano)
 *   - inserts → FX chain + I/O pair (builtin:* for now; wam:* in Phase 4)
 *   - routing → channel output → insert.input or master
 *   - playlist clips → Tone.Part (PatternClip) or Tone.Player (AudioClip)
 *
 * Parity contract: given a Song produced by importer.importLiveScript(),
 * audible output should match the existing `lib/live/engine.ts`.
 */

import * as Tone from "tone";
import {
  newId,
  type Channel,
  type FxSpec,
  type Insert,
  type LaunchQuantize,
  type Pattern,
  type PatternClip,
  type PlaylistClip,
  type Song,
  type StepDiv,
  type UUID,
} from "./model";
import type { Step } from "./mini";
import { SongStore } from "./store";

function quantizeStart(q: LaunchQuantize): string {
  switch (q) {
    case "immediate": return "+0.01";
    case "beat":      return "@4n";
    case "bar":       return "@1m";
    case "2bar":      return "@2m";
    case "4bar":      return "@4m";
  }
}

// ─── Pure helpers (exported for testing) ────────────────────────────────────

const NOTE_RE = /^[a-g][#b]?-?\d$/i;
export function isNote(s: string): boolean {
  return NOTE_RE.test(s);
}

/**
 * Convert a step index to Tone's bars:beats:sixteenths time notation,
 * relative to the start of the Part.
 */
export function stepTimeBBS(i: number, stepDiv: StepDiv): string {
  const sixteenths = stepDiv === "16n" ? i : stepDiv === "32n" ? i / 2 : i * 2;
  const bar = Math.floor(sixteenths / 16);
  const beat = Math.floor((sixteenths % 16) / 4);
  const six = sixteenths - bar * 16 - beat * 4;
  return `${bar}:${beat}:${six}`;
}

/** Diff two collections keyed by `id`. Added, removed, changed (reference-wise). */
export function diffById<T extends { id: UUID }>(
  prev: readonly T[],
  next: readonly T[],
): { added: T[]; removed: T[]; changed: T[] } {
  const prevMap = new Map(prev.map((x) => [x.id, x]));
  const nextMap = new Map(next.map((x) => [x.id, x]));
  const added: T[] = [];
  const changed: T[] = [];
  for (const [id, item] of nextMap) {
    const before = prevMap.get(id);
    if (!before) added.push(item);
    else if (before !== item) changed.push(item);
  }
  const removed: T[] = [];
  for (const [id, item] of prevMap) {
    if (!nextMap.has(id)) removed.push(item);
  }
  return { added, removed, changed };
}

// ─── Voice contract ─────────────────────────────────────────────────────────

interface Voice {
  kind: Channel["kind"];
  output: Tone.ToneAudioNode;
  fireStep(step: Step, time: number): void;
  dispose(): void;
}

function createDrumVoice(): Voice {
  const output = new Tone.Channel({ volume: 0 });
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.8 },
  }).connect(output);
  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
  }).connect(output);
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.1, release: 0.05 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
  }).connect(output);
  hat.volume.value = -18;

  return {
    kind: "drum",
    output,
    fireStep(step, time) {
      if (!step) return;
      const s = step.toLowerCase();
      if (s === "bd" || s === "kick") kick.triggerAttackRelease("C1", "8n", time);
      else if (s === "sd" || s === "snare" || s === "cp" || s === "clap") snare.triggerAttackRelease("16n", time);
      else if (s === "hh" || s === "hat" || s === "oh") hat.triggerAttackRelease("32n", time);
    },
    dispose() {
      kick.disconnect(); kick.dispose();
      snare.disconnect(); snare.dispose();
      hat.disconnect(); hat.dispose();
      output.disconnect(); output.dispose();
    },
  };
}

function createSynthVoice(): Voice {
  const output = new Tone.Channel({ volume: -6 });
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.4 },
  }).connect(output);

  return {
    kind: "synth",
    output,
    fireStep(step, time) {
      if (!step) return;
      if (isNote(step)) synth.triggerAttackRelease(step, "16n", time);
      else if (step.toLowerCase() === "sub" || step.toLowerCase() === "bass") {
        synth.triggerAttackRelease("C2", "8n", time);
      }
    },
    dispose() {
      synth.disconnect(); synth.dispose();
      output.disconnect(); output.dispose();
    },
  };
}

function createSamplerVoice(sampleUrl: string | undefined): Voice {
  const output = new Tone.Channel({ volume: 0 });
  const player = sampleUrl
    ? new Tone.Player({ url: sampleUrl, loop: false }).connect(output)
    : null;

  return {
    kind: "sampler",
    output,
    fireStep(step, time) {
      if (!step || !player || !player.loaded) return;
      player.start(time);
    },
    dispose() {
      player?.disconnect(); player?.dispose();
      output.disconnect(); output.dispose();
    },
  };
}

function createPianoVoice(): Voice {
  // Placeholder — smplr integration lifted verbatim from engine.ts happens in
  // Phase 3 when we have a real piano channel to drive. For Phase 2, the piano
  // voice behaves as a synth with a softer patch so no channel breaks.
  const output = new Tone.Channel({ volume: -3 });
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.2, release: 1.5 },
  }).connect(output);

  return {
    kind: "piano",
    output,
    fireStep(step, time) {
      if (!step) return;
      if (isNote(step)) synth.triggerAttackRelease(step, "8n", time);
    },
    dispose() {
      synth.disconnect(); synth.dispose();
      output.disconnect(); output.dispose();
    },
  };
}

function createVoice(channel: Channel): Voice {
  switch (channel.kind) {
    case "drum": return createDrumVoice();
    case "synth": return createSynthVoice();
    case "sampler": return createSamplerVoice(channel.sampleUrl);
    case "piano": return createPianoVoice();
  }
}

// ─── Built-in FX (builtin:*) ────────────────────────────────────────────────

function createBuiltinFx(type: string, wet: number): Tone.ToneAudioNode {
  const w = Math.max(0, Math.min(1, wet));
  switch (type) {
    case "reverb":     return new Tone.Reverb({ decay: 2.5, wet: w });
    case "delay":      return new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.3, wet: w });
    case "chorus":     return new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: w }).start();
    case "filter":     return new Tone.AutoFilter({ frequency: "4n", baseFrequency: 200, octaves: 4, wet: w }).start();
    case "distortion": return new Tone.Distortion({ distortion: 0.4, wet: w });
    default:           return new Tone.Gain(1); // unknown → transparent
  }
}

function createFxNode(spec: FxSpec): Tone.ToneAudioNode {
  if (spec.pluginUri.startsWith("builtin:")) {
    return createBuiltinFx(spec.pluginUri.slice("builtin:".length), spec.wet);
  }
  // wam:* not yet supported — Phase 4. Return a passthrough so chains stay valid.
  return new Tone.Gain(1);
}

// ─── Insert nodes ───────────────────────────────────────────────────────────

interface InsertNodes {
  input: Tone.Gain;
  output: Tone.Gain;
  fxNodes: Map<UUID, Tone.ToneAudioNode>; // in spec order via fxOrder
  fxOrder: UUID[];
}

function rebuildInsertChain(insert: Insert, nodes: InsertNodes): void {
  // Disconnect existing fx and the input/output
  for (const node of nodes.fxNodes.values()) {
    node.disconnect();
  }
  nodes.input.disconnect();
  nodes.output.disconnect();

  const active = insert.fx.filter((f) => !f.bypassed);
  if (active.length === 0) {
    nodes.input.connect(nodes.output);
    return;
  }

  // Ensure each active spec has a node; dispose removed ones
  const nextIds = new Set(active.map((f) => f.id));
  for (const [id, node] of [...nodes.fxNodes]) {
    if (!nextIds.has(id)) {
      node.dispose();
      nodes.fxNodes.delete(id);
    }
  }
  for (const spec of active) {
    if (!nodes.fxNodes.has(spec.id)) {
      nodes.fxNodes.set(spec.id, createFxNode(spec));
    } else {
      // Update wet on existing node if it has a `wet` param.
      const existing = nodes.fxNodes.get(spec.id)!;
      if ("wet" in existing) {
        (existing as unknown as { wet: Tone.Signal<"normalRange"> }).wet.value =
          Math.max(0, Math.min(1, spec.wet));
      }
    }
  }
  nodes.fxOrder = active.map((f) => f.id);

  // input → fx[0] → ... → fx[n-1] → output
  let prev: Tone.ToneAudioNode = nodes.input;
  for (const id of nodes.fxOrder) {
    const node = nodes.fxNodes.get(id)!;
    prev.connect(node);
    prev = node;
  }
  prev.connect(nodes.output);
}

// ─── Scheduled playlist clips ───────────────────────────────────────────────

interface ScheduledClip {
  clip: PlaylistClip;
  // PatternClip: Part per (pattern x channel) slice
  parts?: Tone.Part[];
  // AudioClip: single Player synced to transport
  player?: Tone.Player;
}

interface PatternEvent {
  time: string; // BBS relative to Part start
  step: Step;
}

export function buildPatternEvents(pattern: Pattern, channelId: UUID): PatternEvent[] {
  const slice = pattern.slices[channelId];
  if (!slice) return [];
  const events: PatternEvent[] = [];
  for (let i = 0; i < slice.steps.length; i++) {
    const step = slice.steps[i];
    if (step == null) continue;
    events.push({ time: stepTimeBBS(i, pattern.stepDiv), step });
  }
  return events;
}

// ─── TransportState (for UI) ────────────────────────────────────────────────

export interface TransportState {
  ready: boolean;
  playing: boolean;
  positionBars: number;
  bar: number;
  beat: number;
  sixteenth: number;
  activeSceneId: UUID | null;
}

type TransportListener = (state: TransportState) => void;

// ─── LiveTransport ──────────────────────────────────────────────────────────

export class LiveTransport {
  private store: SongStore;
  private unsubStore: (() => void) | null = null;

  private initialized = false;
  private playing = false;
  private prev: Song | null = null;

  private masterBus!: Tone.Channel;
  private masterLimiter!: Tone.Limiter;

  private voices = new Map<UUID, Voice>();
  private inserts = new Map<UUID, InsertNodes>();
  private clips = new Map<UUID, ScheduledClip>();
  // Scenes that have been fired but aren't part of the arranged playlist.
  private liveScenes = new Map<UUID, ScheduledClip[]>();
  private activeSceneId: UUID | null = null;

  private positionEventId: number | null = null;
  private listeners = new Set<TransportListener>();
  private state: TransportState = {
    ready: false,
    playing: false,
    positionBars: 0,
    bar: 0,
    beat: 0,
    sixteenth: 0,
    activeSceneId: null,
  };

  constructor(store: SongStore) {
    this.store = store;
  }

  // ─── lifecycle ────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    const song = this.store.getSong();
    const transport = Tone.getTransport();
    transport.bpm.value = song.bpm;

    this.masterLimiter = new Tone.Limiter(-1).toDestination();
    this.masterBus = new Tone.Channel({ volume: song.masterGainDb }).connect(this.masterLimiter);

    this.applyInitial(song);
    this.prev = song;
    this.initialized = true;

    this.unsubStore = this.store.subscribe((s) => {
      if (!this.initialized) return;
      this.apply(s);
    });

    if (this.positionEventId === null) {
      this.positionEventId = transport.scheduleRepeat(() => {
        this.emitPosition();
      }, "16n");
    }

    this.emit();
  }

  async start(): Promise<void> {
    await this.init();
    if (this.playing) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    transport.start("+0.01");
    this.playing = true;
    this.emit();
  }

  stop(): void {
    if (this.initialized) Tone.getTransport().stop();
    this.stopAllScenesInternal();
    this.playing = false;
    this.emit();
  }

  async toggle(): Promise<void> {
    if (this.playing) this.stop();
    else await this.start();
  }

  /**
   * Fire a LaunchGroup — schedule its triggers at the next quantized boundary.
   * Any previously-live scene is stopped when the new scene's start time
   * arrives. Starts the transport if idle.
   */
  async fireLaunchGroup(groupId: UUID): Promise<void> {
    await this.init();
    const song = this.store.getSong();
    const group = song.launchGroups.find((g) => g.id === groupId);
    if (!group) return;

    const transport = Tone.getTransport();
    if (!this.playing) {
      transport.position = 0;
      transport.start("+0.01");
      this.playing = true;
      this.emit();
    }

    const startTime = quantizeStart(group.quantize);
    // Stop the previous scene exactly when the new one begins.
    const prevId = this.activeSceneId;
    if (prevId) {
      transport.scheduleOnce(() => this.stopScene(prevId), startTime);
    }
    this.activeSceneId = group.id;
    this.emit();

    const scheduled: ScheduledClip[] = [];
    for (const trig of group.triggers) {
      if (trig.kind === "pattern") {
        const pattern = song.patterns.find((p) => p.id === trig.patternId);
        if (!pattern) continue;
        for (const channelId of Object.keys(pattern.slices)) {
          const voice = this.voices.get(channelId);
          if (!voice) continue;
          const events = buildPatternEvents(pattern, channelId);
          if (events.length === 0) continue;
          const part = new Tone.Part<PatternEvent>(
            (time, ev) => voice.fireStep(ev.step, time),
            events,
          );
          part.loop = true;
          part.loopEnd = `${pattern.lengthBars}m`;
          part.start(startTime);
          scheduled.push({
            clip: { id: newId(), kind: "pattern", patternId: pattern.id, lane: 0, startBar: 0, lengthBars: pattern.lengthBars, muted: false },
            parts: [part],
          });
        }
      } else {
        const clip = song.playlist.clips.find((c) => c.id === trig.clipId);
        if (!clip || clip.kind !== "audio" || !clip.sampleUrl) continue;
        const player = new Tone.Player({ url: clip.sampleUrl, loop: true }).connect(this.masterBus);
        Tone.loaded().then(() => {
          player.sync().start(startTime);
        }).catch(() => {});
        scheduled.push({ clip, player });
      }
    }
    this.liveScenes.set(group.id, scheduled);
  }

  /** Stop all live-fired scenes (does not affect arranged playlist clips). */
  stopAllScenes(): void {
    this.stopAllScenesInternal();
    this.emit();
  }

  private stopAllScenesInternal(): void {
    for (const id of [...this.liveScenes.keys()]) this.stopScene(id);
    this.activeSceneId = null;
  }

  private stopScene(groupId: UUID): void {
    const scheduled = this.liveScenes.get(groupId);
    if (!scheduled) return;
    for (const s of scheduled) {
      if (s.parts) for (const p of s.parts) { p.stop(); p.dispose(); }
      if (s.player) { s.player.stop(); s.player.disconnect(); s.player.dispose(); }
    }
    this.liveScenes.delete(groupId);
    if (this.activeSceneId === groupId) this.activeSceneId = null;
  }

  getActiveSceneId(): UUID | null {
    return this.activeSceneId;
  }

  dispose(): void {
    this.stop();
    if (this.positionEventId !== null) {
      Tone.getTransport().clear(this.positionEventId);
      this.positionEventId = null;
    }
    this.unsubStore?.();
    this.unsubStore = null;
    for (const clip of this.clips.values()) this.disposeClip(clip);
    this.clips.clear();
    for (const nodes of this.inserts.values()) this.disposeInsert(nodes);
    this.inserts.clear();
    for (const v of this.voices.values()) v.dispose();
    this.voices.clear();
    this.masterBus?.dispose();
    this.masterLimiter?.dispose();
    this.initialized = false;
    this.listeners.clear();
  }

  // ─── public state ─────────────────────────────────────────────────────────

  getState(): TransportState {
    return { ...this.state };
  }

  subscribe(fn: TransportListener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    this.state = {
      ...this.state,
      ready: this.initialized,
      playing: this.playing,
      activeSceneId: this.activeSceneId,
    };
    for (const fn of this.listeners) fn(this.getState());
  }

  private emitPosition(): void {
    const transport = Tone.getTransport();
    const bbs = transport.position.toString().split(":");
    const bar = Number(bbs[0] ?? 0);
    const beat = Math.floor(Number(bbs[1] ?? 0));
    const sixteenth = Math.floor(Number(bbs[2] ?? 0));
    const positionBars = bar + beat / 4 + sixteenth / 16;
    this.state = { ...this.state, bar, beat, sixteenth, positionBars };
    for (const fn of this.listeners) fn(this.getState());
  }

  // ─── apply (diff-driven) ──────────────────────────────────────────────────

  private applyInitial(song: Song): void {
    // Voices (route to master by default)
    for (const ch of song.channels) this.ensureVoice(ch);

    // Inserts
    for (const ins of song.mixer) this.ensureInsert(ins);

    // Route channels to inserts (or master)
    for (const ch of song.channels) this.routeChannel(ch, song);

    // Route inserts to master
    for (const [id, nodes] of this.inserts) {
      const ins = song.mixer.find((i) => i.id === id);
      if (ins) nodes.output.connect(this.masterBus);
    }

    // Playlist
    for (const clip of song.playlist.clips) this.scheduleClip(clip, song);
  }

  private apply(song: Song): void {
    const prev = this.prev ?? song;

    // 1. Scalar transport
    if (song.bpm !== prev.bpm) {
      Tone.getTransport().bpm.rampTo(song.bpm, 0.05);
    }
    if (song.masterGainDb !== prev.masterGainDb) {
      this.masterBus.volume.rampTo(song.masterGainDb, 0.05);
    }

    // 2. Channels (voices)
    const vDiff = diffById(prev.channels, song.channels);
    for (const ch of vDiff.removed) {
      this.voices.get(ch.id)?.dispose();
      this.voices.delete(ch.id);
    }
    for (const ch of vDiff.added) this.ensureVoice(ch);
    for (const ch of vDiff.changed) {
      const before = prev.channels.find((c) => c.id === ch.id)!;
      if (before.kind !== ch.kind || before.sampleUrl !== ch.sampleUrl) {
        // structural — rebuild voice
        this.voices.get(ch.id)?.dispose();
        this.voices.delete(ch.id);
        this.ensureVoice(ch);
      }
      // scalar channel state (gain, pan, mute/solo) applied via output channel
      const voice = this.voices.get(ch.id);
      if (voice?.output instanceof Tone.Channel) {
        voice.output.volume.rampTo(ch.gainDb, 0.03);
        voice.output.mute = ch.muted;
        voice.output.solo = ch.solo;
        voice.output.pan.rampTo(ch.pan, 0.03);
      }
    }

    // 3. Inserts
    const iDiff = diffById(prev.mixer, song.mixer);
    for (const ins of iDiff.removed) {
      const nodes = this.inserts.get(ins.id);
      if (nodes) { this.disposeInsert(nodes); this.inserts.delete(ins.id); }
    }
    for (const ins of iDiff.added) {
      const nodes = this.ensureInsert(ins);
      nodes.output.connect(this.masterBus);
    }
    for (const ins of iDiff.changed) {
      const nodes = this.inserts.get(ins.id);
      if (nodes) rebuildInsertChain(ins, nodes);
    }

    // 4. Routing — any channel whose insertId changed, or whose voice was rebuilt above
    for (const ch of song.channels) {
      const before = prev.channels.find((c) => c.id === ch.id);
      const structural = vDiff.added.includes(ch) || vDiff.changed.includes(ch) && before && (before.kind !== ch.kind || before.sampleUrl !== ch.sampleUrl);
      if (!before || structural || before.insertId !== ch.insertId) {
        this.routeChannel(ch, song);
      }
    }

    // 5. Playlist
    const clipDiff = diffById(prev.playlist.clips, song.playlist.clips);
    for (const clip of clipDiff.removed) this.removeClip(clip.id);
    for (const clip of clipDiff.added) this.scheduleClip(clip, song);

    // For each changed clip → reschedule. Also reschedule any pattern clip whose
    // referenced pattern object changed.
    const changedPatternIds = new Set<UUID>();
    {
      const prevPatternById = new Map(prev.patterns.map((p) => [p.id, p]));
      for (const p of song.patterns) {
        const before = prevPatternById.get(p.id);
        if (!before || before !== p) changedPatternIds.add(p.id);
      }
    }
    for (const clip of clipDiff.changed) {
      this.removeClip(clip.id);
      this.scheduleClip(clip, song);
    }
    for (const clip of song.playlist.clips) {
      if (clipDiff.changed.includes(clip) || clipDiff.added.includes(clip)) continue;
      if (clip.kind === "pattern" && changedPatternIds.has(clip.patternId)) {
        this.removeClip(clip.id);
        this.scheduleClip(clip, song);
      }
    }

    this.prev = song;
  }

  // ─── voice / insert helpers ───────────────────────────────────────────────

  private ensureVoice(channel: Channel): Voice {
    const existing = this.voices.get(channel.id);
    if (existing) return existing;
    const voice = createVoice(channel);
    if (voice.output instanceof Tone.Channel) {
      voice.output.volume.value = channel.gainDb;
      voice.output.pan.value = channel.pan;
      voice.output.mute = channel.muted;
      voice.output.solo = channel.solo;
    }
    this.voices.set(channel.id, voice);
    return voice;
  }

  private ensureInsert(insert: Insert): InsertNodes {
    const existing = this.inserts.get(insert.id);
    if (existing) {
      rebuildInsertChain(insert, existing);
      return existing;
    }
    const nodes: InsertNodes = {
      input: new Tone.Gain(1),
      output: new Tone.Gain(1),
      fxNodes: new Map(),
      fxOrder: [],
    };
    rebuildInsertChain(insert, nodes);
    this.inserts.set(insert.id, nodes);
    return nodes;
  }

  private disposeInsert(nodes: InsertNodes): void {
    for (const n of nodes.fxNodes.values()) n.dispose();
    nodes.input.disconnect(); nodes.input.dispose();
    nodes.output.disconnect(); nodes.output.dispose();
  }

  private routeChannel(channel: Channel, song: Song): void {
    const voice = this.voices.get(channel.id);
    if (!voice) return;
    voice.output.disconnect();
    if (channel.insertId) {
      const insertNodes = this.inserts.get(channel.insertId);
      const insert = song.mixer.find((i) => i.id === channel.insertId);
      if (insertNodes && insert) {
        voice.output.connect(insertNodes.input);
        return;
      }
    }
    voice.output.connect(this.masterBus);
  }

  // ─── clip scheduling ──────────────────────────────────────────────────────

  private scheduleClip(clip: PlaylistClip, song: Song): void {
    if (clip.kind === "pattern") {
      const parts = this.schedulePatternClip(clip, song);
      this.clips.set(clip.id, { clip, parts });
    } else {
      const player = this.scheduleAudioClip(clip);
      this.clips.set(clip.id, { clip, player });
    }
  }

  private schedulePatternClip(clip: PatternClip, song: Song): Tone.Part[] {
    const pattern = song.patterns.find((p) => p.id === clip.patternId);
    if (!pattern) return [];
    const parts: Tone.Part[] = [];
    for (const channelId of Object.keys(pattern.slices)) {
      const voice = this.voices.get(channelId);
      if (!voice) continue;
      const events = buildPatternEvents(pattern, channelId);
      if (events.length === 0) continue;
      const part = new Tone.Part<PatternEvent>(
        (time, ev) => {
          if (clip.muted) return;
          voice.fireStep(ev.step, time);
        },
        events,
      );
      part.loop = true;
      part.loopEnd = `${pattern.lengthBars}m`;
      part.start(`${clip.startBar}m`);
      part.stop(`${clip.startBar + clip.lengthBars}m`);
      parts.push(part);
    }
    return parts;
  }

  private scheduleAudioClip(clip: PlaylistClip): Tone.Player | undefined {
    if (clip.kind !== "audio") return undefined;
    if (!clip.sampleUrl) return undefined;
    const player = new Tone.Player({ url: clip.sampleUrl, loop: false });
    player.volume.value = clip.gainDb;
    player.mute = clip.muted;
    player.connect(this.masterBus);
    // Wait until loaded to actually sync, but stamp start time now so it
    // plays at the right transport position once the buffer is ready.
    Tone.loaded().then(() => {
      player.sync().start(`${clip.startBar}m`).stop(`${clip.startBar + clip.lengthBars}m`);
    }).catch(() => { /* load failed — silent no-op */ });
    return player;
  }

  private removeClip(clipId: UUID): void {
    const scheduled = this.clips.get(clipId);
    if (!scheduled) return;
    this.disposeClip(scheduled);
    this.clips.delete(clipId);
  }

  private disposeClip(scheduled: ScheduledClip): void {
    if (scheduled.parts) {
      for (const p of scheduled.parts) { p.stop(); p.dispose(); }
    }
    if (scheduled.player) { scheduled.player.stop(); scheduled.player.disconnect(); scheduled.player.dispose(); }
  }
}

// ─── Singleton wiring ───────────────────────────────────────────────────────

let _singleton: LiveTransport | null = null;

export function getLiveTransport(store: SongStore): LiveTransport {
  if (typeof window === "undefined") {
    throw new Error("LiveTransport requires browser (Web Audio)");
  }
  if (!_singleton) {
    _singleton = new LiveTransport(store);
    (window as unknown as { LIVE_TRANSPORT: LiveTransport }).LIVE_TRANSPORT = _singleton;
  }
  return _singleton;
}
