/**
 * Streaming TTS client for the voice-engines sidecar's `WS /tts/stream`.
 *
 * Wire protocol:
 *   client → server (text frames):
 *     {"op":"speak", "text": str, "voice"?: str, "speed"?: float,
 *      "utteranceId"?: str}
 *     {"op":"close"}
 *   server → client:
 *     {"type":"start", "sampleRate": int, "utteranceId"?: str}
 *     binary frames: Int16 LE PCM at the engine's native rate
 *     {"type":"end", "utteranceId"?: str}
 *     {"type":"error", "error": str}
 *
 * The sidecar decodes the input text into phrases and emits each as soon as
 * synthesis finishes — first audio out lands within the synthesis time of the
 * shortest phrase, instead of waiting for the entire utterance.
 *
 * Hands raw Int16 PCM to the caller; the AgentOutput AudioBuffer queue
 * decodes and schedules playback. No browser audio APIs are touched here.
 */

export interface StreamingTtsOptions {
  baseUrl?: string;
  engine?: string;
  /** Default voice if the caller doesn't override per-utterance. */
  voice?: string;
  /** Default speed multiplier. */
  speed?: number;
  onStart?: (info: { utteranceId?: string; sampleRate: number }) => void;
  onChunk?: (info: { utteranceId?: string; pcm: ArrayBuffer; sampleRate: number }) => void;
  onEnd?: (info: { utteranceId?: string }) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

export interface SpeakOptions {
  text: string;
  voice?: string;
  speed?: number;
  utteranceId?: string;
}

export class StreamingTtsClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private currentSampleRate = 0;
  private currentUtteranceId: string | undefined;

  constructor(private readonly opts: StreamingTtsOptions = {}) {}

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    const base = this.opts.baseUrl ?? "ws://127.0.0.1:9101";
    const params = new URLSearchParams();
    if (this.opts.engine) params.set("engine", this.opts.engine);
    const url = `${base.replace(/\/$/, "")}/tts/stream${params.toString() ? `?${params}` : ""}`;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      let resolved = false;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          let payload: {
            type?: string;
            sampleRate?: number;
            utteranceId?: string;
            error?: string;
          };
          try {
            payload = JSON.parse(e.data);
          } catch {
            return;
          }
          switch (payload.type) {
            case "start":
              this.currentSampleRate = payload.sampleRate ?? 24000;
              this.currentUtteranceId = payload.utteranceId;
              this.opts.onStart?.({
                utteranceId: payload.utteranceId,
                sampleRate: this.currentSampleRate,
              });
              break;
            case "end":
              this.opts.onEnd?.({ utteranceId: payload.utteranceId });
              this.currentUtteranceId = undefined;
              break;
            case "error":
              this.opts.onError?.(payload.error ?? "unknown tts error");
              break;
          }
        } else if (e.data instanceof ArrayBuffer) {
          this.opts.onChunk?.({
            utteranceId: this.currentUtteranceId,
            pcm: e.data,
            sampleRate: this.currentSampleRate || 24000,
          });
        }
      };
      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`tts stream connect failed: ${url}`));
        }
      };
      ws.onclose = () => {
        this.opts.onClose?.();
        this.ws = null;
        this.connectPromise = null;
      };
    });
    return this.connectPromise;
  }

  /** Queue a `speak` op. Multiple calls serialise on the server. */
  async speak(opts: SpeakOptions): Promise<void> {
    if (!opts.text || !opts.text.trim()) return;
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = {
      op: "speak",
      text: opts.text,
      voice: opts.voice ?? this.opts.voice,
      speed: opts.speed ?? this.opts.speed ?? 1.0,
      utteranceId: opts.utteranceId,
    };
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      /* socket closed mid-send */
    }
  }

  close(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ op: "close" }));
      } catch {
        /* ignore */
      }
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.connectPromise = null;
  }
}

/**
 * Convert an Int16 LE PCM ArrayBuffer to a Float32Array in [-1, 1].
 * Inverse of `float32ToInt16Bytes`. Used by AgentOutput when consuming
 * sidecar TTS chunks before pushing them to AudioBuffers.
 */
export function int16PcmBytesToFloat32(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const samples = buf.byteLength / 2;
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}
