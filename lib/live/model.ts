/**
 * FL-native data model for the Live surface.
 *
 * Four citizens:
 *   - Channel:       sound source (drum/synth/sampler/piano). Holds instrument config.
 *   - Pattern:       cross-channel step snapshot. One pattern fires many channels together.
 *   - PlaylistClip:  arrangement piece placed on a lane. PatternClip refs a Pattern;
 *                    AudioClip plays a rendered audio file directly (no channel).
 *   - Insert:        mixer FX slot. Channels route to inserts; FX live on inserts.
 *
 * LaunchGroup is the Ableton fusion — a named bundle of triggers fireable live.
 *
 * This module is pure data + factory helpers. No Web Audio, no React, no side effects.
 */

import type { Step } from "./mini";

export type UUID = string;

export function newId(): UUID {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// ─── Channel ────────────────────────────────────────────────────────────────

export type ChannelKind = "drum" | "synth" | "sampler" | "piano";

export interface Channel {
  id: UUID;
  name: string;
  kind: ChannelKind;
  gainDb: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  insertId: UUID | null;
  sampleUrl?: string;
}

// ─── Pattern ────────────────────────────────────────────────────────────────

export type StepDiv = "8n" | "16n" | "32n";

export interface ChannelPattern {
  channelId: UUID;
  steps: Step[];
}

export interface Pattern {
  id: UUID;
  name: string;
  lengthBars: number;
  stepDiv: StepDiv;
  slices: Record<UUID, ChannelPattern>;
}

// ─── Playlist clips ─────────────────────────────────────────────────────────

export interface BaseClip {
  id: UUID;
  lane: number;
  startBar: number;
  lengthBars: number;
  muted: boolean;
  name?: string;
}

export interface PatternClip extends BaseClip {
  kind: "pattern";
  patternId: UUID;
}

export type AudioGenStatus = "pending" | "ready" | "error";

export interface AudioGeneration {
  prompt: string;
  duration: number;
  seed?: number;
  loader: "stable-audio" | "ace-step";
  status: AudioGenStatus;
  jobId?: string;
  error?: string;
}

export interface AudioClip extends BaseClip {
  kind: "audio";
  sampleUrl?: string;
  gainDb: number;
  generation?: AudioGeneration;
}

export type PlaylistClip = PatternClip | AudioClip;

export interface Playlist {
  clips: PlaylistClip[];
  laneCount: number;
}

// ─── Launch groups (Ableton fusion) ─────────────────────────────────────────

export type LaunchQuantize = "immediate" | "beat" | "bar" | "2bar" | "4bar";

export type LaunchTrigger =
  | { kind: "pattern"; patternId: UUID }
  | { kind: "audio"; clipId: UUID };

export interface LaunchGroup {
  id: UUID;
  name: string;
  quantize: LaunchQuantize;
  triggers: LaunchTrigger[];
}

// ─── Mixer ──────────────────────────────────────────────────────────────────

export interface FxSpec {
  id: UUID;
  pluginUri: string; // "builtin:reverb" | "builtin:delay" | ... | "wam:<url>"
  params: Record<string, number>;
  wet: number;
  bypassed: boolean;
}

export interface Insert {
  id: UUID;
  name: string;
  gainDb: number;
  fx: FxSpec[];
}

// ─── Song (root) ────────────────────────────────────────────────────────────

export interface Song {
  id: UUID;
  name: string;
  bpm: number;
  timeSigNum: number;
  timeSigDen: number;
  masterGainDb: number;
  channels: Channel[];
  patterns: Pattern[];
  playlist: Playlist;
  launchGroups: LaunchGroup[];
  mixer: Insert[];
  createdAt: number;
  updatedAt: number;
}

// ─── Factories ──────────────────────────────────────────────────────────────

export function createSong(name = "Untitled"): Song {
  const now = Date.now();
  return {
    id: newId(),
    name,
    bpm: 120,
    timeSigNum: 4,
    timeSigDen: 4,
    masterGainDb: 0,
    channels: [],
    patterns: [],
    playlist: { clips: [], laneCount: 8 },
    launchGroups: [],
    mixer: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createChannel(kind: ChannelKind, name?: string): Channel {
  return {
    id: newId(),
    name: name ?? defaultChannelName(kind),
    kind,
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
    insertId: null,
  };
}

function defaultChannelName(kind: ChannelKind): string {
  switch (kind) {
    case "drum": return "drum";
    case "synth": return "synth";
    case "sampler": return "sample";
    case "piano": return "piano";
  }
}

export function createPattern(name = "Pattern 1", lengthBars = 1, stepDiv: StepDiv = "16n"): Pattern {
  return { id: newId(), name, lengthBars, stepDiv, slices: {} };
}

export function createInsert(name = "Insert"): Insert {
  return { id: newId(), name, gainDb: 0, fx: [] };
}

export interface CreatePatternClipOpts {
  patternId: UUID;
  lane: number;
  startBar: number;
  lengthBars: number;
  name?: string;
  muted?: boolean;
}

export function createPatternClip(opts: CreatePatternClipOpts): PatternClip {
  return {
    id: newId(),
    kind: "pattern",
    patternId: opts.patternId,
    lane: opts.lane,
    startBar: opts.startBar,
    lengthBars: opts.lengthBars,
    name: opts.name,
    muted: opts.muted ?? false,
  };
}

export interface CreateAudioClipOpts {
  lane: number;
  startBar: number;
  lengthBars: number;
  name?: string;
  sampleUrl?: string;
  gainDb?: number;
  muted?: boolean;
  generation?: AudioGeneration;
}

export function createAudioClip(opts: CreateAudioClipOpts): AudioClip {
  return {
    id: newId(),
    kind: "audio",
    lane: opts.lane,
    startBar: opts.startBar,
    lengthBars: opts.lengthBars,
    name: opts.name,
    sampleUrl: opts.sampleUrl,
    gainDb: opts.gainDb ?? 0,
    muted: opts.muted ?? false,
    generation: opts.generation,
  };
}

export function createLaunchGroup(name = "Scene 1", quantize: LaunchQuantize = "bar"): LaunchGroup {
  return { id: newId(), name, quantize, triggers: [] };
}

export function createFxSpec(pluginUri: string, params: Record<string, number> = {}, wet = 1): FxSpec {
  return { id: newId(), pluginUri, params, wet, bypassed: false };
}

// ─── Serialization ──────────────────────────────────────────────────────────

export const SONG_SCHEMA_VERSION = 1;

interface SerializedSong {
  schema: number;
  song: Song;
}

export function serializeSong(song: Song): string {
  const payload: SerializedSong = { schema: SONG_SCHEMA_VERSION, song };
  return JSON.stringify(payload);
}

export function deserializeSong(raw: string): Song {
  const parsed = JSON.parse(raw) as SerializedSong | Song;
  if ("schema" in parsed && "song" in parsed) {
    if (parsed.schema !== SONG_SCHEMA_VERSION) {
      throw new Error(`Unsupported Song schema version ${parsed.schema}`);
    }
    return parsed.song;
  }
  // Tolerate a bare Song payload too (no wrapper).
  return parsed as Song;
}
