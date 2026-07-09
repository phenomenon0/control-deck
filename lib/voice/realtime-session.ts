/**
 * OpenAI Realtime-compatible voice transport.
 *
 * Framework-free: owns only the WebSocket protocol bridge. The React session
 * hook owns mic/output lifecycles and maps callbacks into the voice FSM.
 */

import {
  downsamplePcmFloat32To16k,
  float32ToInt16Bytes,
} from "./audio-input";

export interface RealtimeCallbacks {
  onStatus(s: "connecting" | "connected" | "disconnected"): void;
  onSpeechStarted(): void;
  onSpeechStopped(): void;
  onTranscriptionDelta(text: string): void;
  onTranscriptionCompleted(text: string): void;
  onResponseCreated(): void;
  onAudioDelta(pcm: ArrayBuffer, sampleRate: number): void;
  onAssistantTranscript(text: string): void;
  onResponseDone(status: "completed" | "cancelled"): void;
  onError(message: string): void;
}

type RealtimeStatus = "connecting" | "connected" | "disconnected";

interface RealtimeEvent {
  type?: string;
  delta?: string;
  audio?: string;
  transcript?: string;
  text?: string;
  message?: string;
  sampleRate?: number;
  sample_rate?: number;
  response?: {
    status?: string;
    status_details?: {
      error?: {
        message?: string;
      };
    };
  };
  error?: {
    message?: string;
  } | string;
}

export class RealtimeVoiceClient {
  private readonly wsUrl: string;
  private readonly callbacks: RealtimeCallbacks;
  private readonly outputRate: number;

  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;
  private status: RealtimeStatus = "disconnected";
  private closedByClient = false;
  private sessionCreated = false;
  private micPaused = true;
  private interruptEnabled = true;

  constructor(opts: {
    wsUrl: string;
    callbacks: RealtimeCallbacks;
    outputRate?: number;
  }) {
    this.wsUrl = opts.wsUrl;
    this.callbacks = opts.callbacks;
    // s2s emits TTS audio at its 16 kHz pipeline rate when the session does
    // not override the output format (we don't — see sendSessionUpdate).
    this.outputRate = opts.outputRate ?? 16000;
  }

  connect(): Promise<void> {
    if (this.sessionCreated && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;

    this.closedByClient = false;
    this.sessionCreated = false;
    this.setStatus("connecting");

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      let socket: WebSocket;
      try {
        socket = new WebSocket(this.wsUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not open realtime websocket";
        this.failConnect(message);
        return;
      }

      this.ws = socket;
      socket.onmessage = (event) => this.handleMessage(event);
      socket.onerror = () => {
        this.callbacks.onError("Realtime websocket error");
      };
      socket.onclose = () => {
        const wasConnected = this.sessionCreated;
        this.ws = null;
        this.sessionCreated = false;
        this.connectPromise = null;
        if (!wasConnected && !this.closedByClient) {
          this.failConnect("Realtime websocket closed before session.created");
        }
        this.setStatus("disconnected");
      };
    });

    return this.connectPromise;
  }

  close(): void {
    this.closedByClient = true;
    this.sessionCreated = false;
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    const socket = this.ws;
    this.ws = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    this.setStatus("disconnected");
  }

  appendAudio(frame: Float32Array, srcRate: number): void {
    if (this.micPaused || !this.sessionCreated) return;
    if (!frame.length) return;
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const pcm16 = float32ToInt16Bytes(downsamplePcmFloat32To16k(frame, srcRate));
    if (pcm16.byteLength === 0) return;
    this.send({
      type: "input_audio_buffer.append",
      audio: arrayBufferToBase64(pcm16),
    });
  }

  setMicPaused(paused: boolean): void {
    this.micPaused = paused;
  }

  cancelResponse(): void {
    this.send({ type: "response.cancel" });
  }

  setInterruptEnabled(on: boolean): void {
    this.interruptEnabled = on;
    if (!this.sessionCreated) return;
    this.sendSessionUpdate();
  }

  private handleMessage(event: MessageEvent): void {
    let data: RealtimeEvent;
    try {
      data = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as RealtimeEvent;
    } catch {
      this.callbacks.onError("Realtime websocket sent invalid JSON");
      return;
    }

    switch (data.type) {
      case "session.created":
        this.sessionCreated = true;
        this.sendSessionUpdate();
        this.setStatus("connected");
        this.connectResolve?.();
        this.connectResolve = null;
        this.connectReject = null;
        return;

      case "input_audio_buffer.speech_started":
        this.callbacks.onSpeechStarted();
        return;

      case "input_audio_buffer.speech_stopped":
        this.callbacks.onSpeechStopped();
        return;

      case "conversation.item.input_audio_transcription.delta":
        this.callbacks.onTranscriptionDelta(data.delta ?? data.text ?? "");
        return;

      case "conversation.item.input_audio_transcription.completed":
        this.callbacks.onTranscriptionCompleted(data.transcript ?? data.text ?? "");
        return;

      case "response.created":
        this.callbacks.onResponseCreated();
        return;

      case "response.output_audio.delta": {
        const encoded = data.delta ?? data.audio ?? "";
        if (!encoded) return;
        try {
          this.callbacks.onAudioDelta(
            base64ToArrayBuffer(encoded),
            data.sampleRate ?? data.sample_rate ?? this.outputRate,
          );
        } catch {
          this.callbacks.onError("Realtime websocket sent invalid audio delta");
        }
        return;
      }

      case "response.output_audio.done":
        return;

      case "response.output_audio_transcript.done":
        this.callbacks.onAssistantTranscript(data.transcript ?? data.text ?? "");
        return;

      case "response.output_text.delta":
      case "response.output_text.done":
        this.callbacks.onAssistantTranscript(data.delta ?? data.text ?? "");
        return;

      case "response.done": {
        const status = normalizeResponseStatus(data.response?.status);
        const message = data.response?.status_details?.error?.message;
        if (message) this.callbacks.onError(message);
        this.callbacks.onResponseDone(status);
        return;
      }

      case "error": {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.error?.message ?? data.message ?? "Realtime websocket error";
        this.callbacks.onError(message);
        return;
      }

      default:
        return;
    }
  }

  private sendSessionUpdate(): void {
    // Payload must validate against the OpenAI SDK's SessionUpdateEvent, which
    // pins audio/pcm to rate 24000 — so we send no format blocks at all and
    // ride the s2s defaults (16 kHz in and out, matching our mic downsampling
    // and playback fallback). Only turn_detection is negotiated here; the
    // required session.type and turn_detection.type literals must be present
    // or the server rejects the event.
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              interrupt_response: this.interruptEnabled,
            },
          },
        },
      },
    });
  }

  private send(payload: unknown): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatus(status);
  }

  private failConnect(message: string): void {
    const reject = this.connectReject;
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.callbacks.onError(message);
    reject?.(new Error(message));
    this.setStatus("disconnected");
  }
}

function normalizeResponseStatus(status: string | undefined): "completed" | "cancelled" {
  return status === "cancelled" || status === "canceled" ? "cancelled" : "completed";
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
