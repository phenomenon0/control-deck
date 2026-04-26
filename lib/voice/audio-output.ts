/**
 * `AgentOutput` — owns the playback side of the voice loop.
 *
 *   - One AudioContext, one post-processing graph (compressor → EQ → reverb,
 *     ported verbatim from `lib/hooks/useVoiceChat.ts:69-129`).
 *   - A queue of AudioBuffers scoped to a `SpeechHandle` so a barge-in can
 *     drop only that handle's buffers without touching anything pre-loaded.
 *   - Output device routing: when an `audioOutputId` is set, the destination
 *     is routed through a `MediaStreamAudioDestinationNode` into a hidden
 *     `<audio>` element with `setSinkId(deviceId)`. Falls back to the default
 *     `AudioContext.destination` when no device is picked.
 *
 * No React in here — just Web Audio. The React layer wraps it.
 */

import { SpeechHandle } from "./speech-handle";

export interface AgentOutputOptions {
  /** Initial output device id (optional). */
  outputDeviceId?: string | null;
}

export interface AgentOutputEventMap {
  speechStart: { handle: SpeechHandle };
  speechEnd: { handle: SpeechHandle };
  drained: void;
}

type Listener<T> = (payload: T) => void;

export class AgentOutput {
  private ctx: AudioContext | null = null;
  private graphInput: GainNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private activeHandle: SpeechHandle | null = null;

  /** When non-null we route through a MediaStream + <audio> for setSinkId. */
  private routedSink: {
    dest: MediaStreamAudioDestinationNode;
    el: HTMLAudioElement;
  } | null = null;
  private outputDeviceId: string | null;

  private listeners = new Map<keyof AgentOutputEventMap, Set<Listener<unknown>>>();

  constructor(options: AgentOutputOptions = {}) {
    this.outputDeviceId = options.outputDeviceId ?? null;
  }

  /**
   * Lazily create the AudioContext + processing graph on first use. Browsers
   * require a user gesture; callers must invoke this from a click/keydown.
   */
  async ensureReady(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this.ctx;
    }

    const ctx = new AudioContext();
    this.ctx = ctx;

    const { input, output } = createProcessorGraph(ctx);
    this.graphInput = input;

    if (this.outputDeviceId) {
      this.attachRoutedSink(ctx, output, this.outputDeviceId);
    } else {
      output.connect(ctx.destination);
    }

    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }

  /**
   * Switch the output device. If the AudioContext exists, rewires the graph;
   * otherwise stores the id for the next `ensureReady()`.
   */
  async setOutputDevice(deviceId: string | null): Promise<void> {
    this.outputDeviceId = deviceId;
    if (!this.ctx || !this.graphInput) return;

    // We don't have a direct handle to the post-graph output node here, so
    // re-route by reconstructing the tail. Easier: tear down and rebuild.
    const ctx = this.ctx;
    const oldInput = this.graphInput;
    oldInput.disconnect();
    if (this.routedSink) {
      try {
        oldInput.disconnect(this.routedSink.dest);
      } catch {
        /* ignore */
      }
      this.routedSink.el.pause();
      this.routedSink.el.srcObject = null;
      this.routedSink = null;
    }

    const { input, output } = createProcessorGraph(ctx);
    this.graphInput = input;

    if (deviceId) {
      this.attachRoutedSink(ctx, output, deviceId);
    } else {
      output.connect(ctx.destination);
    }
  }

  /** Schedule an AudioBuffer to play, tagged to the active SpeechHandle. */
  async play(handle: SpeechHandle, buffer: AudioBuffer): Promise<void> {
    if (handle.state === "interrupted") return;
    const ctx = await this.ensureReady();

    handle.buffers.push(buffer);

    if (this.activeHandle && this.activeHandle !== handle) {
      // Another utterance is in flight — don't barge it; queue handles serially.
      // Simplest behavior: ignore until the active one drains.
      // Real session orchestration prevents two concurrent handles in practice.
      return;
    }
    if (!this.currentSource) {
      this.activeHandle = handle;
      this.startNext(ctx);
    }
  }

  /**
   * Stop everything for a handle: stop the current source if it belongs to it,
   * drop queued buffers, and call `handle.interrupt()` so any pending fetches
   * also abort.
   */
  interrupt(handle: SpeechHandle, reason?: string): void {
    if (this.activeHandle === handle) {
      this.stopCurrentSource();
      this.activeHandle = null;
    }
    handle.interrupt(reason);
    this.emit("speechEnd", { handle });
    this.emit("drained", undefined);
  }

  /** Stop everything regardless of handle. Used for global mute / reset. */
  stopAll(): void {
    this.stopCurrentSource();
    if (this.activeHandle) {
      const h = this.activeHandle;
      this.activeHandle = null;
      h.interrupt("stopAll");
      this.emit("speechEnd", { handle: h });
    }
    this.emit("drained", undefined);
  }

  on<K extends keyof AgentOutputEventMap>(
    type: K,
    fn: Listener<AgentOutputEventMap[K]>,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<unknown>);
    return () => set!.delete(fn as Listener<unknown>);
  }

  private emit<K extends keyof AgentOutputEventMap>(
    type: K,
    payload: AgentOutputEventMap[K],
  ): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const l of set) {
      try {
        (l as Listener<AgentOutputEventMap[K]>)(payload);
      } catch {
        /* swallow */
      }
    }
  }

  private startNext(ctx: AudioContext): void {
    const handle = this.activeHandle;
    if (!handle || handle.state === "interrupted") {
      this.activeHandle = null;
      this.emit("drained", undefined);
      return;
    }
    const buffer = handle.buffers.shift();
    if (!buffer) {
      // Nothing more queued for this handle right now.
      if (handle.state === "done") {
        const finished = this.activeHandle;
        this.activeHandle = null;
        this.emit("speechEnd", { handle: finished! });
        this.emit("drained", undefined);
      }
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (this.graphInput) source.connect(this.graphInput);
    else source.connect(ctx.destination);

    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
      }
      // If this handle was interrupted mid-source, don't continue.
      if (handle.state === "interrupted") {
        if (this.activeHandle === handle) this.activeHandle = null;
        this.emit("speechEnd", { handle });
        this.emit("drained", undefined);
        return;
      }
      this.startNext(ctx);
    };

    this.currentSource = source;
    handle.markSpeaking();
    this.emit("speechStart", { handle });
    source.start(0);
  }

  private stopCurrentSource(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        /* already stopped */
      }
      this.currentSource = null;
    }
  }

  private attachRoutedSink(
    ctx: AudioContext,
    output: AudioNode,
    deviceId: string,
  ): void {
    const dest = ctx.createMediaStreamDestination();
    output.connect(dest);
    const el = new Audio();
    el.srcObject = dest.stream;
    el.autoplay = true;
    // setSinkId is only on supported browsers; type-cast for TS.
    const elWithSink = el as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (typeof elWithSink.setSinkId === "function") {
      elWithSink.setSinkId(deviceId).catch(() => {
        /* fall through to default sink — better than silence */
      });
    }
    void el.play().catch(() => {
      /* autoplay may fail until next user gesture; ignore */
    });
    this.routedSink = { dest, el };
  }
}

/**
 * Builds: input → compressor → eqLow → eqHigh → output (dry)
 *         input → convolver → reverbGain → output (wet, 8% mix)
 *         output gain = 1.1
 *
 * Verbatim port of the chain from useVoiceChat.ts:69-129.
 */
function createProcessorGraph(ctx: AudioContext): {
  input: GainNode;
  output: GainNode;
} {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 30;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "peaking";
  eqHigh.frequency.value = 3000;
  eqHigh.Q.value = 1;
  eqHigh.gain.value = 2;

  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "peaking";
  eqLow.frequency.value = 200;
  eqLow.Q.value = 1;
  eqLow.gain.value = 1;

  const convolver = ctx.createConvolver();
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.08;

  const impulseLength = Math.floor(ctx.sampleRate * 0.3);
  const impulse = ctx.createBuffer(2, impulseLength, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < impulseLength; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (impulseLength / 4));
    }
  }
  convolver.buffer = impulse;

  input.connect(compressor);
  compressor.connect(eqLow);
  eqLow.connect(eqHigh);
  eqHigh.connect(output);

  input.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(output);

  output.gain.value = 1.1;

  return { input, output };
}
