/**
 * Streaming STT client for the voice-engines sidecar's `WS /stt/stream`.
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
 * Falls back to silent no-ops if the sidecar is unreachable; the legacy batch
 * `POST /stt` path stays in place for callers that want guaranteed delivery.
 */

import { downsamplePcmFloat32To16k, float32ToInt16Bytes } from "@/lib/voice/audio-input";

export interface StreamingSttOptions {
  /** Base URL like `ws://127.0.0.1:9101`. Defaults to the standard sidecar. */
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
}

export class StreamingSttClient {
  private ws: WebSocket | null = null;
  private readyPromise: Promise<void> | null = null;
  private closed = false;
  constructor(private readonly opts: StreamingSttOptions = {}) {}

  /** Open the WS and resolve when the server emits `ready`. Idempotent. */
  connect(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    const base = this.opts.baseUrl ?? "ws://127.0.0.1:9101";
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
      };
    });
    return this.readyPromise;
  }

  /** Send a Float32 audio frame at `srcSampleRate`; resampled to 16 kHz. */
  pushFloat32(frame: Float32Array, srcSampleRate: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const downsampled = downsamplePcmFloat32To16k(frame, srcSampleRate);
    const pcm = float32ToInt16Bytes(downsampled);
    try {
      this.ws.send(pcm);
    } catch {
      /* socket may have closed mid-send; ignore */
    }
  }

  /** Send a raw Int16 PCM @ 16 kHz buffer (used by tests + AudioWorklet bridge). */
  pushPcm16(buf: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(buf);
    } catch {
      /* ignore */
    }
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
  }

  private sendOp(op: "flush" | "final" | "reset"): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ op }));
    } catch {
      /* ignore */
    }
  }
}
