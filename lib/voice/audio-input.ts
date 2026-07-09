/**
 * `AgentInput` — owns the capture side of the voice loop.
 *
 *   - Opens the mic via `getUserMedia` with the persisted `deviceId`.
 *   - Routes the stream into an AudioContext for analysis.
 *   - Tries Silero VAD via `@ricky0123/vad-web` (AudioWorklet + onnxruntime-web)
 *     first; falls back to an energy-threshold VAD on an AnalyserNode if the
 *     worklet or ONNX assets fail to load (offline, no WASM, etc).
 *   - Emits `audioFrame`, `vad`, `level`, and `error` events on a simple
 *     listener API. The session orchestrator subscribes; the React layer only
 *     sees `start()` / `stop()` / `getStream()` / `setDeviceId()`.
 *
 * No React in here.
 */

import type { MicVAD as MicVADType } from "@ricky0123/vad-web";

type ProbeShape = { mark: (name: string, meta?: Record<string, unknown>) => void };
const probe = (): ProbeShape | undefined =>
  (globalThis as { __voiceProbe?: ProbeShape }).__voiceProbe;

export type VadEvent =
  | { type: "speechStart"; at: number }
  | { type: "speechEnd"; at: number; durationMs: number; samples?: Float32Array }
  | { type: "speechProb"; prob: number; at: number }
  | { type: "misfire"; at: number };

export type VadBackend = "silero" | "energy";

export interface AgentInputOptions {
  inputDeviceId?: string | null;
  /** Emit raw PCM frames continuously while the mic is open. */
  audioFrameMode?: "speech-end" | "continuous";
  /** RMS threshold in [0,1]. Used by the energy fallback VAD. */
  silenceThreshold?: number;
  /** ms of sub-threshold audio before declaring end of speech. */
  silenceTimeoutMs?: number;
  /** Reuse an existing AudioContext (e.g. shared with AgentOutput). */
  audioContext?: AudioContext | null;
  /** Override worklet/ONNX asset locations. Defaults to `/audio-worklets/`. */
  vadAssetBasePath?: string;
  /** Force a specific VAD backend (mostly for tests / debugging). */
  forceVadBackend?: VadBackend;
}

export interface AgentInputEventMap {
  audioFrame: { samples: Float32Array; sampleRate: number; at: number };
  vad: VadEvent;
  level: { rms: number; at: number };
  error: { message: string };
  vadBackendChanged: { backend: VadBackend };
}

type Listener<T> = (payload: T) => void;

const DEFAULT_VAD_ASSET_PATH = "/audio-worklets/";

// ---------------------------------------------------------------------------
// PCM helpers used by the capture path and tests.

/**
 * Cheap linear-decimation downsampler from any source rate to 16 kHz.
 * Adequate for STT (Whisper et al.) where the model already does its own
 * featurisation. Avoids pulling in a real DSP dependency.
 */
export function downsamplePcmFloat32To16k(
  frame: Float32Array,
  srcSampleRate: number,
): Float32Array {
  const target = 16000;
  if (srcSampleRate === target) return frame;
  if (srcSampleRate < target) return frame; // upsampling not useful for STT
  const ratio = srcSampleRate / target;
  const outLength = Math.floor(frame.length / ratio);
  const out = new Float32Array(outLength);
  let pos = 0;
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(pos);
    const end = Math.min(frame.length, Math.floor(pos + ratio));
    let acc = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      acc += frame[j];
      count++;
    }
    out[i] = count > 0 ? acc / count : 0;
    pos += ratio;
  }
  return out;
}

/** Convert Float32 [-1, 1] samples to little-endian Int16 PCM bytes. */
export function float32ToInt16Bytes(frame: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(frame.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < frame.length; i++) {
    let s = Math.max(-1, Math.min(1, frame[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, s | 0, true);
  }
  return buf;
}

export class AgentInput {
  private inputDeviceId: string | null;
  private silenceThreshold: number;
  private silenceTimeoutMs: number;
  private audioFrameMode: "speech-end" | "continuous";
  private vadAssetBasePath: string;
  private forceVadBackend: VadBackend | null;

  private ownedCtx: AudioContext | null = null;
  private ctx: AudioContext | null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private pcmSource: MediaStreamAudioSourceNode | null = null;
  private pcmNode: ScriptProcessorNode | null = null;
  private pcmSink: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;

  private hasSpoken = false;
  private silenceStartAt: number | null = null;
  private speechStartAt: number | null = null;

  private micVad: MicVADType | null = null;
  private currentBackend: VadBackend | null = null;

  private listeners = new Map<keyof AgentInputEventMap, Set<Listener<unknown>>>();

  constructor(options: AgentInputOptions = {}) {
    this.inputDeviceId = options.inputDeviceId ?? null;
    this.audioFrameMode = options.audioFrameMode ?? "speech-end";
    this.silenceThreshold = options.silenceThreshold ?? 0.01;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? 1500;
    this.ctx = options.audioContext ?? null;
    this.vadAssetBasePath = options.vadAssetBasePath ?? DEFAULT_VAD_ASSET_PATH;
    this.forceVadBackend = options.forceVadBackend ?? null;
  }

  setInputDevice(deviceId: string | null): void {
    this.inputDeviceId = deviceId;
  }

  /** Tunables read by the energy VAD; the Silero path ignores these. */
  setVadParams(opts: { silenceThreshold?: number; silenceTimeoutMs?: number }): void {
    if (opts.silenceThreshold !== undefined) this.silenceThreshold = opts.silenceThreshold;
    if (opts.silenceTimeoutMs !== undefined) this.silenceTimeoutMs = opts.silenceTimeoutMs;
  }

  /** Which VAD is currently driving events. `null` until `start()` resolves. */
  get vadBackend(): VadBackend | null {
    return this.currentBackend;
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

    if (this.audioFrameMode === "continuous") {
      this.startContinuousAudioFrames();
    }

    if (this.forceVadBackend === "energy") {
      this.startEnergyVad();
      return;
    }

    const sileroOk = await this.tryStartSileroVad(stream);
    if (!sileroOk) {
      this.startEnergyVad();
    }
  }

  /** Stop the mic, release tracks, stop both VAD backends. */
  async stop(): Promise<void> {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.micVad) {
      try {
        await this.micVad.destroy();
      } catch {
        /* ignore */
      }
      this.micVad = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.pcmNode) {
      try {
        this.pcmNode.disconnect();
      } catch {
        /* ignore */
      }
      this.pcmNode.onaudioprocess = null;
      this.pcmNode = null;
    }
    if (this.pcmSource) {
      try {
        this.pcmSource.disconnect();
      } catch {
        /* ignore */
      }
      this.pcmSource = null;
    }
    if (this.pcmSink) {
      try {
        this.pcmSink.disconnect();
      } catch {
        /* ignore */
      }
      this.pcmSink = null;
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
    this.currentBackend = null;
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
   * Boot the Silero MicVAD via dynamic import. We share our already-acquired
   * stream by passing a `getStream` that resolves to it. Returns false if the
   * worklet/ONNX bundle fails to load — caller falls back to energy VAD.
   */
  private async tryStartSileroVad(stream: MediaStream): Promise<boolean> {
    try {
      const mod = await import("@ricky0123/vad-web");
      const ctx = this.ctx ?? undefined;
      const startedAt = { value: 0 };

      const micVad = await mod.MicVAD.new({
        model: "v5",
        baseAssetPath: this.vadAssetBasePath,
        onnxWASMBasePath: this.vadAssetBasePath,
        audioContext: ctx,
        getStream: async () => stream,
        startOnLoad: false,
        // Defaults cut at ~256 ms of silence, which fires mid-sentence on
        // natural pauses. ~900 ms tolerates breath-pauses but still feels
        // responsive once the user actually stops.
        redemptionMs: 900,
        // Slightly higher onset threshold so room noise / lip smacks don't
        // open the gate; lower release threshold so trailing words aren't
        // chopped.
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.35,
        // Require a bit more sustained speech before declaring an utterance
        // so a single cough or "uh" doesn't trip a full STT round-trip.
        minSpeechMs: 128,
        onSpeechStart: () => {
          const now = performance.now();
          startedAt.value = now;
          probe()?.mark("vad_speech_start", { backend: "silero" });
          probe()?.mark("chunk_first", { backend: "silero" });
          this.emit("vad", { type: "speechStart", at: now });
        },
        onSpeechEnd: (samples: Float32Array) => {
          const now = performance.now();
          probe()?.mark("vad_speech_end", { backend: "silero", samples: samples.length });
          probe()?.mark("chunk_last", { backend: "silero", samples: samples.length });
          if (this.audioFrameMode === "speech-end") {
            this.emit("audioFrame", { samples, sampleRate: 16000, at: now });
          }
          this.emit("vad", {
            type: "speechEnd",
            at: now,
            durationMs: startedAt.value ? now - startedAt.value : 0,
            samples,
          });
        },
        onVADMisfire: () => {
          this.emit("vad", { type: "misfire", at: performance.now() });
        },
        onFrameProcessed: (probs: { isSpeech: number; notSpeech: number }) => {
          const now = performance.now();
          this.emit("vad", { type: "speechProb", prob: probs.isSpeech, at: now });
          this.emit("level", { rms: probs.isSpeech, at: now });
        },
      });

      await micVad.start();
      this.micVad = micVad;
      this.currentBackend = "silero";
      this.emit("vadBackendChanged", { backend: "silero" });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[AgentInput] Silero VAD unavailable, falling back to energy:", msg);
      return false;
    }
  }

  private startEnergyVad(): void {
    if (!this.ctx || !this.stream) return;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    this.hasSpoken = false;
    this.silenceStartAt = null;
    this.speechStartAt = null;
    this.currentBackend = "energy";
    this.emit("vadBackendChanged", { backend: "energy" });
    this.tickEnergyVad();
  }

  private startContinuousAudioFrames(): void {
    if (!this.ctx || !this.stream || this.pcmNode) return;
    const ctx = this.ctx;
    const source = ctx.createMediaStreamSource(this.stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      this.emit("audioFrame", {
        samples: new Float32Array(channel),
        sampleRate: event.inputBuffer.sampleRate,
        at: performance.now(),
      });
    };
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    this.pcmSource = source;
    this.pcmNode = node;
    this.pcmSink = sink;
  }

  /**
   * rAF loop that samples the AnalyserNode and emits `level` + energy-based
   * VAD events. Active only when the Silero path failed to load.
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
          probe()?.mark("vad_speech_start", { backend: "energy" });
          probe()?.mark("chunk_first", { backend: "energy" });
          this.emit("vad", { type: "speechStart", at: now });
        }
        this.silenceStartAt = null;
      } else if (this.hasSpoken) {
        if (this.silenceStartAt === null) {
          this.silenceStartAt = now;
        } else if (now - this.silenceStartAt >= this.silenceTimeoutMs) {
          const startedAt = this.speechStartAt ?? now;
          probe()?.mark("vad_speech_end", { backend: "energy" });
          probe()?.mark("chunk_last", { backend: "energy" });
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
