/**
 * Streaming STT client for voice-core's `WS /stt/stream`.
 *
 * Wire protocol mirrors the server:
 *   client → server:
 *     - binary frames: Int16 LE PCM @ 16 kHz mono
 *     - text frames:   {"op":"flush"|"final"|"reset"}
 *   server → client:
 *     - text frames:   {"type":"ready"|"partial"|"final"|"error", ...}
 *
 * The client owns three things:
 *   1. The WebSocket lifecycle (connect, retry hook, close).
 *   2. PCM resampling — `pushFloat32(frame, srcSampleRate)` resamples to 16 kHz
 *      on the way in so callers can hand it native AudioContext frames.
 *   3. Surface callbacks — `onPartial`, `onFinal`, `onError`, `onReady`.
 *
 * Frames and ops queued before the server emits `ready` are buffered (bounded)
 * and drained as soon as the socket opens. Falls back to silent no-ops if the
 * sidecar is unreachable; the legacy batch `POST /stt` path stays in place for
 * callers that want guaranteed delivery.
 */

import { downsamplePcmFloat32To16k, float32ToInt16Bytes } from "@/lib/voice/audio-input";

declare global {
  // eslint-disable-next-line no-var
  var __voiceProbe: { mark(name: string, meta?: Record<string, unknown>): void } | undefined;
}

export interface StreamingSttOptions {
  /** Base URL like `ws://127.0.0.1:4245`. Defaults to the local voice-core sidecar. */
  baseUrl?: string;
  /** Engine id; omitted = use the sidecar's tier default. */
  engine?: string;
  /** Optional language hint; passed as a query param for engines that use it. */
  language?: string;
  onReady?: (info: { engine: string; sampleRate: number }) => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
  /**
   * Hard cap on the pre-handshake binary frame buffer, in bytes. ~96 KB =
   * ~3 s of 16 kHz Int16 mono. Frames over the cap drop the oldest first so
   * the most recent speech survives a slow handshake.
   */
  preopenFrameCapBytes?: number;
  /**
   * Two-stage correction. When set, every PCM chunk pushed is also accumulated
   * locally; on the streaming engine's final, the buffered audio is POSTed to
   * `correctionUrl` with `engine` / `model` form fields equal to this value
   * and `onFinal` fires with the corrected text instead of the streaming
   * text. Falls back silently to the streaming text on timeout, HTTP error,
   * or any network failure (does NOT call `onError` — correction is
   * best-effort polish, not a session-fatal path).
   *
   * Set to e.g. `"whisper-base-en-cpp"` to upgrade rough sherpa finals to
   * Whisper-quality finals on Mac.
   */
  correctionEngine?: string;
  /**
   * URL the correction call POSTs to. Defaults to `/api/voice/stt` — the
   * Next.js proxy that side-steps CORS by forwarding server-side to the
   * voice-core sidecar. Tests / non-browser callers should pass an absolute
   * URL like `http://127.0.0.1:4245/stt`.
   */
  correctionUrl?: string;
  /** Max ms to wait for the correction round-trip. Default 5000. */
  correctionTimeoutMs?: number;
  /** Hard cap on accumulated correction-buffer bytes. Default 30 s @ 16 kHz Int16 = ~960 KB. */
  correctionBufferCapBytes?: number;
  /** Fires after each final with timing + which path emitted (corrected or fallback). */
  onCorrectionLatency?: (info: { latencyMs: number; corrected: boolean; bufferBytes: number }) => void;
}

type Op = "flush" | "final" | "reset";

const DEFAULT_PREOPEN_CAP_BYTES = 96 * 1024;
const DEFAULT_CORRECTION_TIMEOUT_MS = 5000;
const DEFAULT_CORRECTION_BUFFER_CAP_BYTES = 30 * 16_000 * 2; // 30 s @ 16 kHz Int16 mono

export class StreamingSttClient {
  private ws: WebSocket | null = null;
  private readyPromise: Promise<void> | null = null;
  private ready = false;
  private closed = false;

  /** Bytes queued while the WS is connecting; drained on `ready`. */
  private pendingFrames: ArrayBuffer[] = [];
  private pendingFramesBytes = 0;
  private pendingOps: Op[] = [];

  /** Per-utterance PCM buffer used by the correction pass. Empty when correctionEngine is unset. */
  private utterancePcm: Uint8Array[] = [];
  private utterancePcmBytes = 0;
  /** Monotonic counter; lets us discard a correction response if a reset/close happened mid-flight. */
  private utteranceSeq = 0;

  private readonly preopenCap: number;
  private readonly correctionTimeoutMs: number;
  private readonly correctionBufferCap: number;

  constructor(private readonly opts: StreamingSttOptions = {}) {
    this.preopenCap = opts.preopenFrameCapBytes ?? DEFAULT_PREOPEN_CAP_BYTES;
    this.correctionTimeoutMs = opts.correctionTimeoutMs ?? DEFAULT_CORRECTION_TIMEOUT_MS;
    this.correctionBufferCap = opts.correctionBufferCapBytes ?? DEFAULT_CORRECTION_BUFFER_CAP_BYTES;
  }

  /** Open the WS and resolve when the server emits `ready`. Idempotent. */
  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("stt client closed"));
    if (this.readyPromise) return this.readyPromise;
    const base = this.opts.baseUrl ?? "ws://127.0.0.1:4245";
    const params = new URLSearchParams();
    if (this.opts.engine) params.set("engine", this.opts.engine);
    if (this.opts.language) params.set("language", this.opts.language);
    const url = `${base.replace(/\/$/, "")}/stt/stream${params.toString() ? `?${params}` : ""}`;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      let resolved = false;
      let sawPartial = false;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => {
        globalThis.__voiceProbe?.mark("ws_open", { url });
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        let payload: { type?: string; text?: string; error?: string; engine?: string; sampleRate?: number };
        try {
          payload = JSON.parse(e.data);
        } catch {
          return;
        }
        switch (payload.type) {
          case "ready":
            this.ready = true;
            this.drainPending();
            globalThis.__voiceProbe?.mark("stt_ready", { engine: payload.engine, sampleRate: payload.sampleRate });
            this.opts.onReady?.({
              engine: payload.engine ?? "",
              sampleRate: payload.sampleRate ?? 16000,
            });
            if (!resolved) {
              resolved = true;
              resolve();
            }
            break;
          case "partial":
            if (!sawPartial) {
              sawPartial = true;
              globalThis.__voiceProbe?.mark("stt_partial_first", { text: payload.text });
            }
            globalThis.__voiceProbe?.mark("stt_partial", { text: payload.text });
            this.opts.onPartial?.(payload.text ?? "");
            break;
          case "final":
            globalThis.__voiceProbe?.mark("stt_final", { text: payload.text });
            this.handleStreamFinal(payload.text ?? "");
            break;
          case "error":
            this.opts.onError?.(payload.error ?? "unknown error");
            if (!resolved) {
              resolved = true;
              reject(new Error(payload.error ?? "stt stream error"));
            }
            break;
        }
      };
      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`stt stream connect failed: ${url}`));
        }
      };
      ws.onclose = () => {
        this.opts.onClose?.();
        this.ws = null;
        this.readyPromise = null;
        this.ready = false;
        // Drop any unsent buffered frames; the connection is gone.
        this.pendingFrames = [];
        this.pendingFramesBytes = 0;
        this.pendingOps = [];
      };
    });
    return this.readyPromise;
  }

  /** Send a Float32 audio frame at `srcSampleRate`; resampled to 16 kHz. */
  pushFloat32(frame: Float32Array, srcSampleRate: number): void {
    if (this.closed) return;
    const downsampled = downsamplePcmFloat32To16k(frame, srcSampleRate);
    const pcm = float32ToInt16Bytes(downsampled);
    this.sendBinary(pcm);
  }

  /** Send a raw Int16 PCM @ 16 kHz buffer (used by tests + AudioWorklet bridge). */
  pushPcm16(buf: ArrayBuffer): void {
    if (this.closed) return;
    this.sendBinary(buf);
  }

  /** Ask the server to emit a partial covering everything received so far. */
  flush(): void {
    this.sendOp("flush");
  }

  /** End-of-utterance — server emits one final + clears its buffer. */
  final(): void {
    this.sendOp("final");
  }

  /** Drop the server-side buffer without emitting anything. */
  reset(): void {
    this.sendOp("reset");
    this.dropUtteranceBuffer();
  }

  close(): void {
    this.closed = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.readyPromise = null;
    this.ready = false;
    this.pendingFrames = [];
    this.pendingFramesBytes = 0;
    this.pendingOps = [];
    this.dropUtteranceBuffer();
  }

  /** Test/visibility hook. */
  pendingFrameBytes(): number {
    return this.pendingFramesBytes;
  }

  private sendBinary(buf: ArrayBuffer): void {
    if (this.closed) return;
    this.captureForCorrection(buf);
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(buf);
      } catch {
        /* socket may have closed mid-send; ignore */
      }
      return;
    }
    // Pre-handshake — buffer with a hard byte cap. Drop oldest first so the
    // freshest speech survives a slow handshake instead of the user's first
    // 100-300 ms vanishing into the void.
    this.pendingFrames.push(buf);
    this.pendingFramesBytes += buf.byteLength;
    while (this.pendingFramesBytes > this.preopenCap && this.pendingFrames.length > 1) {
      const dropped = this.pendingFrames.shift();
      if (dropped) this.pendingFramesBytes -= dropped.byteLength;
    }
  }

  private sendOp(op: Op): void {
    if (this.closed) return;
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ op }));
      } catch {
        /* ignore */
      }
      return;
    }
    this.pendingOps.push(op);
  }

  private drainPending(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const frame of this.pendingFrames) {
      try {
        this.ws.send(frame);
      } catch {
        /* ignore */
      }
    }
    this.pendingFrames = [];
    this.pendingFramesBytes = 0;
    for (const op of this.pendingOps) {
      try {
        this.ws.send(JSON.stringify({ op }));
      } catch {
        /* ignore */
      }
    }
    this.pendingOps = [];
  }

  private captureForCorrection(buf: ArrayBuffer): void {
    if (!this.opts.correctionEngine) return;
    const view = new Uint8Array(buf.slice(0));
    this.utterancePcm.push(view);
    this.utterancePcmBytes += view.byteLength;
    while (this.utterancePcmBytes > this.correctionBufferCap && this.utterancePcm.length > 1) {
      const dropped = this.utterancePcm.shift();
      if (dropped) this.utterancePcmBytes -= dropped.byteLength;
    }
  }

  private dropUtteranceBuffer(): void {
    this.utterancePcm = [];
    this.utterancePcmBytes = 0;
    this.utteranceSeq += 1;
  }

  private handleStreamFinal(roughText: string): void {
    if (!this.opts.correctionEngine || this.utterancePcmBytes === 0) {
      this.opts.onFinal?.(roughText);
      this.dropUtteranceBuffer();
      return;
    }
    const seq = this.utteranceSeq;
    const pcm = this.consumeUtteranceBuffer();
    void this.runCorrection(pcm, roughText, seq);
  }

  private consumeUtteranceBuffer(): Uint8Array {
    const total = this.utterancePcmBytes;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.utterancePcm) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.utterancePcm = [];
    this.utterancePcmBytes = 0;
    this.utteranceSeq += 1;
    return out;
  }

  private async runCorrection(pcm: Uint8Array, roughText: string, seq: number): Promise<void> {
    const engine = this.opts.correctionEngine!;
    // Default to the Next.js proxy so browser callers don't hit CORS posting
    // directly to the voice-core sidecar.
    const url = this.opts.correctionUrl ?? "/api/voice/stt";
    const wav = wrapPcm16AsWav(pcm, 16000);
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let corrected: string | null = null;
    try {
      const fd = new FormData();
      // Cast around the TS 5.7 Uint8Array<ArrayBufferLike> vs BufferSource mismatch.
      const blob = new Blob([wav as BlobPart], { type: "audio/wav" });
      fd.append("audio", blob, "utterance.wav");
      // Send both: voice-core's /stt reads `engine`, the Next.js proxy reads
      // `model`. FastAPI ignores unknown form fields, so dual-tagging is safe.
      fd.append("engine", engine);
      fd.append("model", engine);
      fd.append("mimeType", "audio/wav");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.correctionTimeoutMs);
      try {
        const res = await fetch(url, { method: "POST", body: fd, signal: ctrl.signal });
        if (!res.ok) throw new Error(`correction HTTP ${res.status}`);
        const json = (await res.json()) as { text?: string };
        corrected = (json.text ?? "").trim();
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      // Correction is best-effort polish. A failure here must NOT crash the
      // session — fall back to the rough streaming final and log only.
      const msg = err instanceof Error ? err.message : String(err);
      globalThis.__voiceProbe?.mark("stt_correction_error", { error: msg });
      if (typeof console !== "undefined") {
        console.warn("[streaming-stt] correction failed; using rough final:", msg);
      }
    }
    // If a reset/close happened mid-flight, the seq advanced; drop the result.
    if (this.closed || seq + 1 !== this.utteranceSeq) {
      // The post-consume bump made seq+1 the "current" until something else mutates it.
      // If anything has since changed, abandon — the corrected text would land out of order.
      return;
    }
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    const usedCorrection = !!corrected;
    const finalText = corrected || roughText;
    globalThis.__voiceProbe?.mark("stt_final_corrected", {
      latencyMs: Math.round(elapsed),
      corrected: usedCorrection,
      roughText,
      finalText,
    });
    this.opts.onCorrectionLatency?.({
      latencyMs: Math.round(elapsed),
      corrected: usedCorrection,
      bufferBytes: pcm.byteLength,
    });
    this.opts.onFinal?.(finalText);
  }

  private httpBase(): string {
    const base = (this.opts.baseUrl ?? "ws://127.0.0.1:4245").replace(/\/$/, "");
    if (base.startsWith("wss://")) return "https://" + base.slice("wss://".length);
    if (base.startsWith("ws://")) return "http://" + base.slice("ws://".length);
    return base;
  }
}

/** Wrap raw little-endian Int16 PCM bytes as a minimal RIFF/WAVE container. */
export function wrapPcm16AsWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const headerSize = 44;
  const out = new Uint8Array(headerSize + dataSize);
  const dv = new DataView(out.buffer);
  // RIFF header
  out[0] = 0x52; out[1] = 0x49; out[2] = 0x46; out[3] = 0x46; // "RIFF"
  dv.setUint32(4, 36 + dataSize, true);
  out[8] = 0x57; out[9] = 0x41; out[10] = 0x56; out[11] = 0x45; // "WAVE"
  // fmt subchunk
  out[12] = 0x66; out[13] = 0x6d; out[14] = 0x74; out[15] = 0x20; // "fmt "
  dv.setUint32(16, 16, true);            // subchunk1 size
  dv.setUint16(20, 1, true);             // audio format = PCM
  dv.setUint16(22, numChannels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  // data subchunk
  out[36] = 0x64; out[37] = 0x61; out[38] = 0x74; out[39] = 0x61; // "data"
  dv.setUint32(40, dataSize, true);
  out.set(pcm, headerSize);
  return out;
}
