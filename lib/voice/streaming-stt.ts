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
}

type Op = "flush" | "final" | "reset";

const DEFAULT_PREOPEN_CAP_BYTES = 96 * 1024;

export class StreamingSttClient {
  private ws: WebSocket | null = null;
  private readyPromise: Promise<void> | null = null;
  private ready = false;
  private closed = false;

  /** Bytes queued while the WS is connecting; drained on `ready`. */
  private pendingFrames: ArrayBuffer[] = [];
  private pendingFramesBytes = 0;
  private pendingOps: Op[] = [];

  private readonly preopenCap: number;

  constructor(private readonly opts: StreamingSttOptions = {}) {
    this.preopenCap = opts.preopenFrameCapBytes ?? DEFAULT_PREOPEN_CAP_BYTES;
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
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
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
            this.opts.onPartial?.(payload.text ?? "");
            break;
          case "final":
            this.opts.onFinal?.(payload.text ?? "");
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
  }

  /** Test/visibility hook. */
  pendingFrameBytes(): number {
    return this.pendingFramesBytes;
  }

  private sendBinary(buf: ArrayBuffer): void {
    if (this.closed) return;
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
}
