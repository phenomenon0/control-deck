"use client";

import * as Tone from "tone";
import { parsePattern, type Step } from "./mini";

export type FxType = "reverb" | "delay" | "chorus" | "filter" | "distortion";

export interface TrackFx {
  type: FxType;
  node: Tone.ToneAudioNode;
  wet: number;
}

export interface FxSpec {
  type: FxType;
  wet?: number;
}

export interface TrackState {
  id: number;
  name: string;
  pattern: string;
  steps: Step[];
  instrument: "drum" | "synth" | "sample";
  gain: number;
  muted: boolean;
  solo: boolean;
  fx: Array<{ type: FxType; wet: number }>;
  sampleUrl?: string;
}

export interface EngineState {
  ready: boolean;
  playing: boolean;
  bpm: number;
  masterGain: number;
  bar: number;
  step: number;
  tracks: TrackState[];
}

const NUM_TRACKS = 8;
const DEFAULT_BPM = 120;
const DEFAULT_STEPS = 16;
const STEP_INTERVAL = "8n";
const NOTE_RE = /^[a-g][#b]?-?\d$/i;

function isNote(s: string): boolean {
  return NOTE_RE.test(s);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

type Voice = {
  channel: Tone.Channel;
  instruments: Tone.ToneAudioNode[];
  kick?: Tone.MembraneSynth;
  snare?: Tone.NoiseSynth;
  hat?: Tone.MetalSynth;
  synth?: Tone.PolySynth;
  player?: Tone.Player;
};

function createDrumVoice(dest: Tone.InputNode): Voice {
  const channel = new Tone.Channel({ volume: 0 }).connect(dest);
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.8 },
  });
  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
  });
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.1, release: 0.05 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
  });
  hat.volume.value = -18;
  const instruments: Tone.ToneAudioNode[] = [kick, snare, hat];
  for (const inst of instruments) inst.connect(channel);
  return { channel, instruments, kick, snare, hat };
}

function createSynthVoice(dest: Tone.InputNode): Voice {
  const channel = new Tone.Channel({ volume: -6 }).connect(dest);
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.4 },
  });
  synth.connect(channel);
  return { channel, instruments: [synth], synth };
}

function fireStep(voice: Voice, step: Step, time: number) {
  if (!step) return;
  if (voice.synth && isNote(step)) {
    voice.synth.triggerAttackRelease(step, "16n", time);
    return;
  }
  const s = step.toLowerCase();
  if (voice.kick && (s === "bd" || s === "kick")) {
    voice.kick.triggerAttackRelease("C1", "8n", time);
  } else if (voice.snare && (s === "sd" || s === "snare" || s === "cp" || s === "clap")) {
    voice.snare.triggerAttackRelease("16n", time);
  } else if (voice.hat && (s === "hh" || s === "hat" || s === "oh")) {
    voice.hat.triggerAttackRelease("32n", time);
  } else if (voice.synth && (s === "sub" || s === "bass")) {
    voice.synth.triggerAttackRelease("C2", "8n", time);
  }
}

function defaultWet(type: FxType): number {
  switch (type) {
    case "reverb": return 0.4;
    case "delay": return 0.3;
    case "chorus": return 0.4;
    case "filter": return 0.5;
    case "distortion": return 0.3;
  }
}

function setNodeWet(node: Tone.ToneAudioNode, wet: number) {
  if ("wet" in node) {
    (node as { wet: Tone.Signal<"normalRange"> }).wet.value = wet;
  }
}

function createFxNode(type: FxType, wet = defaultWet(type)): Tone.ToneAudioNode {
  let node: Tone.ToneAudioNode;
  switch (type) {
    case "reverb":
      node = new Tone.Reverb({ decay: 2.5, wet });
      break;
    case "delay":
      node = new Tone.FeedbackDelay({ delayTime: STEP_INTERVAL, feedback: 0.3, wet });
      break;
    case "chorus":
      node = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet }).start();
      break;
    case "filter":
      node = new Tone.AutoFilter({ frequency: "4n", baseFrequency: 200, octaves: 4, wet }).start();
      break;
    case "distortion":
      node = new Tone.Distortion({ distortion: 0.4, wet });
      break;
  }
  setNodeWet(node, wet);
  return node;
}

type Listener = (state: EngineState) => void;

export class LiveEngine {
  private tracks: TrackState[] = [];
  private voices: Voice[] = [];
  private trackFx: TrackFx[][] = [];
  private sequences: Array<Tone.Sequence<Step> | null> = [];
  private masterBus!: Tone.Channel;
  private masterLimiter!: Tone.Limiter;
  private masterGain = 0;
  private playheadEventId: number | null = null;
  private initialized = false;
  private listeners: Set<Listener> = new Set();
  private playing = false;
  private bpm = DEFAULT_BPM;
  private stepIdx = -1;

  constructor() {
    for (let i = 0; i < NUM_TRACKS; i++) {
      this.tracks.push({
        id: i,
        name: i === 0 ? "kick" : i === 1 ? "snare" : i === 2 ? "hat" : i === 3 ? "bass" : `t${i}`,
        pattern: "",
        steps: [],
        instrument: i < 3 ? "drum" : "synth",
        gain: 0,
        muted: false,
        solo: false,
        fx: [],
      });
      this.sequences.push(null);
      this.trackFx.push([]);
    }
  }

  async init() {
    if (this.initialized) return;
    await Tone.start();
    const transport = Tone.getTransport();
    transport.bpm.value = this.bpm;

    this.masterLimiter = new Tone.Limiter(-1).toDestination();
    this.masterBus = new Tone.Channel({ volume: this.masterGain }).connect(this.masterLimiter);

    for (let i = 0; i < NUM_TRACKS; i++) {
      this.voices.push(
        this.tracks[i].instrument === "drum"
          ? createDrumVoice(this.masterBus)
          : createSynthVoice(this.masterBus),
      );
    }

    this.initialized = true;
    for (let i = 0; i < NUM_TRACKS; i++) this.rebuildFxNodes(i);

    for (let i = 0; i < NUM_TRACKS; i++) {
      if (this.tracks[i].pattern) this.setTrack(i, this.tracks[i].pattern);
    }

    if (this.playheadEventId === null) {
      this.playheadEventId = transport.scheduleRepeat(() => {
        this.stepIdx = (this.stepIdx + 1) % this.getPlayheadLength();
        queueMicrotask(() => this.emit());
      }, STEP_INTERVAL);
    }

    this.emit();
  }

  async start() {
    await this.init();
    if (this.playing) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    this.stepIdx = -1;
    transport.start("+0.01");
    this.playing = true;
    this.emit();
  }

  stop() {
    if (this.initialized) Tone.getTransport().stop();
    this.playing = false;
    this.stepIdx = -1;
    this.emit();
  }

  toggle() {
    if (this.playing) this.stop();
    else this.start();
  }

  setBPM(bpm: number) {
    this.bpm = Math.max(40, Math.min(300, bpm));
    if (this.initialized) Tone.getTransport().bpm.rampTo(this.bpm, 0.1);
    this.emit();
  }

  setMasterGain(db: number) {
    this.masterGain = Math.max(-60, Math.min(6, db));
    if (this.initialized) this.masterBus.volume.value = this.masterGain;
    this.emit();
  }

  setTrack(idx: number, pattern: string, name?: string) {
    if (idx < 0 || idx >= NUM_TRACKS) return;
    const track = this.tracks[idx];
    const steps = parsePattern(pattern);
    track.pattern = pattern;
    track.steps = steps;
    if (name?.trim()) track.name = name.trim();

    if (!this.initialized) {
      this.emit();
      return;
    }

    const old = this.sequences[idx];
    if (old) { old.stop(); old.dispose(); }

    if (steps.length === 0) {
      this.sequences[idx] = null;
      this.emit();
      return;
    }

    const voice = this.voices[idx];
    const seq = new Tone.Sequence<Step>(
      (time, step) => {
        if (track.muted) return;
        fireStep(voice, step, time);
      },
      steps,
      STEP_INTERVAL,
    );
    seq.start(0);
    this.sequences[idx] = seq;
    this.emit();
  }

  setTrackName(idx: number, name: string) {
    const t = this.tracks[idx];
    if (!t || !name.trim()) return;
    t.name = name.trim();
    this.emit();
  }

  setGain(idx: number, db: number) {
    const t = this.tracks[idx];
    if (!t) return;
    t.gain = Math.max(-60, Math.min(6, db));
    if (this.voices[idx]) this.voices[idx].channel.volume.value = t.gain;
    this.emit();
  }

  setMute(idx: number, muted: boolean) {
    const t = this.tracks[idx];
    if (!t) return;
    t.muted = muted;
    if (this.voices[idx]) this.voices[idx].channel.mute = muted;
    this.emit();
  }

  setSolo(idx: number, solo: boolean) {
    const t = this.tracks[idx];
    if (!t) return;
    t.solo = solo;
    if (this.voices[idx]) this.voices[idx].channel.solo = solo;
    this.emit();
  }

  addFx(idx: number, type: FxType, wet = defaultWet(type)) {
    if (idx < 0 || idx >= NUM_TRACKS) return;
    const clampedWet = clamp(wet, 0, 1);
    this.tracks[idx].fx.push({ type, wet: clampedWet });
    if (this.initialized) {
      const node = createFxNode(type, clampedWet);
      this.trackFx[idx].push({ type, node, wet: clampedWet });
      this.rebuildChain(idx);
    }
    this.emit();
  }

  setFxChain(idx: number, chain: FxSpec[]) {
    if (idx < 0 || idx >= NUM_TRACKS) return;
    this.tracks[idx].fx = chain.map((fx) => ({
      type: fx.type,
      wet: clamp(fx.wet ?? defaultWet(fx.type), 0, 1),
    }));
    if (this.initialized) this.rebuildFxNodes(idx);
    this.emit();
  }

  removeFx(idx: number, fxIdx: number) {
    if (idx < 0 || idx >= NUM_TRACKS) return;
    const trackFx = this.tracks[idx].fx;
    if (fxIdx < 0 || fxIdx >= trackFx.length) return;
    this.tracks[idx].fx.splice(fxIdx, 1);
    const chain = this.trackFx[idx];
    const removed = chain.splice(fxIdx, 1)[0];
    if (removed) {
      removed.node.disconnect();
      removed.node.dispose();
    }
    if (this.initialized) this.rebuildChain(idx);
    this.emit();
  }

  setFxWet(idx: number, fxIdx: number, wet: number) {
    const clamped = Math.max(0, Math.min(1, wet));
    const trackFx = this.tracks[idx]?.fx;
    if (!trackFx || fxIdx < 0 || fxIdx >= trackFx.length) return;
    trackFx[fxIdx].wet = clamped;

    const chain = this.trackFx[idx];
    if (!chain || fxIdx < 0 || fxIdx >= chain.length) {
      this.emit();
      return;
    }
    const fx = chain[fxIdx];
    setNodeWet(fx.node, clamped);
    fx.wet = clamped;
    this.emit();
  }

  private rebuildFxNodes(idx: number) {
    for (const fx of this.trackFx[idx]) {
      fx.node.disconnect();
      fx.node.dispose();
    }
    this.trackFx[idx] = this.tracks[idx].fx.map(({ type, wet }) => ({
      type,
      wet,
      node: createFxNode(type, wet),
    }));
    this.rebuildChain(idx);
  }

  private rebuildChain(idx: number) {
    const voice = this.voices[idx];
    if (!voice) return;
    const chain = this.trackFx[idx];

    // Disconnect all instruments from everything
    for (const inst of voice.instruments) inst.disconnect();

    // Disconnect all fx nodes
    for (const fx of chain) fx.node.disconnect();

    if (chain.length === 0) {
      // Instruments → channel directly
      for (const inst of voice.instruments) inst.connect(voice.channel);
    } else {
      // Instruments → fx[0] → fx[1] → ... → channel
      for (const inst of voice.instruments) inst.connect(chain[0].node);
      for (let i = 0; i < chain.length - 1; i++) {
        chain[i].node.connect(chain[i + 1].node);
      }
      chain[chain.length - 1].node.connect(voice.channel);
    }
  }

  // Piano (lazy-loaded smplr)
  private piano: unknown = null;
  private pianoChannel: Tone.Channel | null = null;

  async getPiano() {
    if (this.piano) return this.piano;
    await this.init();
    const { SplendidGrandPiano } = await import("smplr");
    this.pianoChannel = new Tone.Channel({ volume: -3 }).connect(this.masterBus);
    const ctx = Tone.getContext().rawContext as AudioContext;
    const p = new SplendidGrandPiano(ctx, { destination: this.pianoChannel as unknown as AudioNode });
    await p.loaded();
    this.piano = p;
    return p;
  }

  async playNote(midi: number, velocity = 80) {
    const p = await this.getPiano() as { start: (opts: { note: number; velocity: number }) => void };
    p.start({ note: midi, velocity });
  }

  releaseNote(midi: number) {
    if (!this.piano) return;
    const p = this.piano as { stop: (note: number) => void };
    p.stop(midi);
  }

  // Sample loading (Tone.Player)
  async loadSample(idx: number, url: string) {
    if (idx < 0 || idx >= NUM_TRACKS || !this.initialized) return;
    const track = this.tracks[idx];
    const voice = this.voices[idx];

    // Dispose old instruments
    for (const inst of voice.instruments) { inst.disconnect(); inst.dispose(); }
    voice.instruments = [];
    voice.kick = undefined;
    voice.snare = undefined;
    voice.hat = undefined;
    voice.synth = undefined;
    if (voice.player) { voice.player.disconnect(); voice.player.dispose(); }

    const player = new Tone.Player({ url, loop: true });
    await Tone.loaded();
    player.connect(voice.channel);
    player.sync().start(0);
    voice.player = player;
    voice.instruments = [player];
    track.instrument = "sample";
    track.sampleUrl = url;
    this.rebuildChain(idx);
    this.emit();
  }

  clear(idx: number) {
    this.setTrack(idx, "");
  }

  private getPlayheadLength(): number {
    return Math.max(DEFAULT_STEPS, ...this.tracks.map((t) => t.steps.length));
  }

  getState(): EngineState {
    return {
      ready: this.initialized,
      playing: this.playing,
      bpm: this.bpm,
      masterGain: this.masterGain,
      bar: 0,
      step: this.stepIdx,
      tracks: this.tracks.map((t) => ({ ...t, fx: [...t.fx] })),
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.getState();
    for (const fn of this.listeners) fn(s);
  }
}

let _singleton: LiveEngine | null = null;

export function getLiveEngine(): LiveEngine {
  if (typeof window === "undefined") {
    throw new Error("LiveEngine requires browser (Web Audio)");
  }
  if (!_singleton) {
    _singleton = new LiveEngine();
    (window as unknown as { LIVE: LiveEngine }).LIVE = _singleton;
  }
  return _singleton;
}
