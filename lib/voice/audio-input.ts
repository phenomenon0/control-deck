/**
 * `AgentInput` — owns the capture side of the voice loop.
 *
 *   - Opens the mic via `getUserMedia` with the persisted `deviceId`.
 *   - Routes the stream into an AudioContext for analysis.
 *   - In phase 1 we keep the existing energy-threshold VAD so behavior is
 *     unchanged; phase 2 swaps in a Silero AudioWorklet via `attachVadWorklet`.
 *   - Emits `audioFrame` (raw Float32 mono frames) and `vad` events on a
 *     simple listener API. The session orchestrator subscribes; the React
 *     layer only sees `start()` / `stop()` / `getStream()` / `setDeviceId()`.
 *
 * No React in here.
 */

export type VadEvent =
  | { type: "speechStart"; at: number }
  | { type: "speechEnd"; at: number; durationMs: number }
  | { type: "speechProb"; prob: number; at: number };

export interface AgentInputOptions {
  inputDeviceId?: string | null;
  /** RMS threshold in [0,1]. Used by the energy fallback VAD. */
  silenceThreshold?: number;
  /** ms of sub-threshold audio before declaring end of speech. */
  silenceTimeoutMs?: number;
  /** Reuse an existing AudioContext (e.g. shared with AgentOutput). */
  audioContext?: AudioContext | null;
}

export interface AgentInputEventMap {
  audioFrame: { samples: Float32Array; sampleRate: number; at: number };
  vad: VadEvent;
  level: { rms: number; at: number };
  error: { message: string };
}

type Listener<T> = (payload: T) => void;

export class AgentInput {
  private inputDeviceId: string | null;
  private silenceThreshold: number;
  private silenceTimeoutMs: number;

  private ownedCtx: AudioContext | null = null;
  private ctx: AudioContext | null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;

  private hasSpoken = false;
  private silenceStartAt: number | null = null;
  private speechStartAt: number | null = null;

  private listeners = new Map<keyof AgentInputEventMap, Set<Listener<unknown>>>();

  constructor(options: AgentInputOptions = {}) {
    this.inputDeviceId = options.inputDeviceId ?? null;
    this.silenceThreshold = options.silenceThreshold ?? 0.01;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? 1500;
    this.ctx = options.audioContext ?? null;
  }

  setInputDevice(deviceId: string | null): void {
    this.inputDeviceId = deviceId;
  }

  /** Tunables read by the energy VAD; phase 2 worklet ignores these. */
  setVadParams(opts: { silenceThreshold?: number; silenceTimeoutMs?: number }): void {
    if (opts.silenceThreshold !== undefined) this.silenceThreshold = opts.silenceThreshold;
    if (opts.silenceTimeoutMs !== undefined) this.silenceTimeoutMs = opts.silenceTimeoutMs;
  }

  /** Open mic + start emitting frames + VAD. Idempotent on a running input. */
  async start(): Promise<void> {
    if (this.stream) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.inputDeviceId ? { exact: this.inputDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not access microphone";
      this.emit("error", { message: msg });
      throw err;
    }

    this.stream = stream;
    if (!this.ctx) {
      this.ownedCtx = new AudioContext();
      this.ctx = this.ownedCtx;
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);

    this.hasSpoken = false;
    this.silenceStartAt = null;
    this.speechStartAt = null;
    this.tickEnergyVad();
  }

  /** Stop the mic, release tracks, stop monitoring. */
  async stop(): Promise<void> {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* ignore */
      }
      this.analyser = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ownedCtx) {
      try {
        await this.ownedCtx.close();
      } catch {
        /* ignore */
      }
      this.ownedCtx = null;
      this.ctx = null;
    }
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  on<K extends keyof AgentInputEventMap>(
    type: K,
    fn: Listener<AgentInputEventMap[K]>,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<unknown>);
    return () => set!.delete(fn as Listener<unknown>);
  }

  private emit<K extends keyof AgentInputEventMap>(
    type: K,
    payload: AgentInputEventMap[K],
  ): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const l of set) {
      try {
        (l as Listener<AgentInputEventMap[K]>)(payload);
      } catch {
        /* swallow */
      }
    }
  }

  /**
   * rAF loop that samples the AnalyserNode and emits `level` + energy-based
   * VAD events. Phase 2 replaces this with the Silero worklet path; this
   * method stays as the fallback when the worklet fails to load.
   */
  private tickEnergyVad(): void {
    if (!this.analyser) return;
    const analyser = this.analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!this.analyser) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms / 128);
      const now = performance.now();

      this.emit("level", { rms: level, at: now });

      if (level >= this.silenceThreshold) {
        if (!this.hasSpoken) {
          this.hasSpoken = true;
          this.speechStartAt = now;
          this.emit("vad", { type: "speechStart", at: now });
        }
        this.silenceStartAt = null;
      } else if (this.hasSpoken) {
        if (this.silenceStartAt === null) {
          this.silenceStartAt = now;
        } else if (now - this.silenceStartAt >= this.silenceTimeoutMs) {
          const startedAt = this.speechStartAt ?? now;
          this.emit("vad", {
            type: "speechEnd",
            at: now,
            durationMs: now - startedAt,
          });
          this.hasSpoken = false;
          this.silenceStartAt = null;
          this.speechStartAt = null;
        }
      }

      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }
}
