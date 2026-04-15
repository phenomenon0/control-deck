"use client";

import * as Tone from "tone";
import { parsePattern, type Step } from "./mini";

export interface TrackState {
  id: number;
  name: string;
  pattern: string;
  steps: Step[];
  instrument: "drum" | "synth";
  gain: number;
  muted: boolean;
  solo: boolean;
}

export interface EngineState {
  ready: boolean;
  playing: boolean;
  bpm: number;
  bar: number;
  step: number;
  tracks: TrackState[];
}

const NUM_TRACKS = 8;
const DEFAULT_BPM = 120;

const NOTE_RE = /^[a-g][#b]?-?\d$/i;

function isNote(s: string): boolean {
  return NOTE_RE.test(s);
}

type Voice = {
  channel: Tone.Channel;
  kick?: Tone.MembraneSynth;
  snare?: Tone.NoiseSynth;
  hat?: Tone.MetalSynth;
  synth?: Tone.PolySynth;
};

function createDrumVoice(): Voice {
  const channel = new Tone.Channel({ volume: 0 }).toDestination();
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.8 },
  }).connect(channel);
  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
  }).connect(channel);
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.1, release: 0.05 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
  }).connect(channel);
  hat.volume.value = -18;
  return { channel, kick, snare, hat };
}

function createSynthVoice(): Voice {
  const channel = new Tone.Channel({ volume: -6 }).toDestination();
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.4 },
  }).connect(channel);
  return { channel, synth };
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

type Listener = (state: EngineState) => void;

export class LiveEngine {
  private tracks: TrackState[] = [];
  private voices: Voice[] = [];
  private sequences: Array<Tone.Sequence<Step> | null> = [];
  private initialized = false;
  private listeners: Set<Listener> = new Set();
  private playing = false;
  private bpm = DEFAULT_BPM;
  private stepIdx = 0;

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
      });
      this.sequences.push(null);
    }
  }

  async init() {
    if (this.initialized) return;
    await Tone.start();
    const transport = Tone.getTransport();
    transport.bpm.value = this.bpm;

    for (let i = 0; i < NUM_TRACKS; i++) {
      this.voices.push(
        this.tracks[i].instrument === "drum" ? createDrumVoice() : createSynthVoice(),
      );
    }

    this.initialized = true;
    this.emit();
  }

  async start() {
    await this.init();
    Tone.getTransport().start();
    this.playing = true;
    this.emit();
  }

  stop() {
    Tone.getTransport().stop();
    this.playing = false;
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

  setTrack(idx: number, pattern: string) {
    if (idx < 0 || idx >= NUM_TRACKS) return;
    const track = this.tracks[idx];
    const steps = parsePattern(pattern);
    track.pattern = pattern;
    track.steps = steps;

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
        if (idx === 0) {
          this.stepIdx = (this.stepIdx + 1) % Math.max(1, steps.length);
          queueMicrotask(() => this.emit());
        }
      },
      steps,
      "1m",
    );
    seq.start(0);
    this.sequences[idx] = seq;
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

  clear(idx: number) {
    this.setTrack(idx, "");
  }

  getState(): EngineState {
    return {
      ready: this.initialized,
      playing: this.playing,
      bpm: this.bpm,
      bar: 0,
      step: this.stepIdx,
      tracks: this.tracks.map((t) => ({ ...t })),
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
