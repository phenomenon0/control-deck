/**
 * Voice-agent transport — the deck's end of the pipecat JSON protocol spoken
 * by voice-agent-linux/agent.py and the Mac agent. Framework-free: owns only
 * the socket; the session hook owns mic/output and maps callbacks into the
 * voice FSM.
 *
 * Wire, union of both agents (each ignores what it doesn't know):
 *   → {type:"auth",token}                              first message
 *   → {type:"audio",sample_rate:16000,channels:1,data:<b64 pcm16>,token}
 *   → {type:"interrupt",token}                         deck-side stop (Linux)
 *   → {type:"playback_done",turn_id,token}             after audio_end drained (Mac)
 *   ← {type:"event",event:{type,...}}                  see handleEvent
 *   ← {type:"audio",sample_rate,channels,data,turn_id?}
 * `token` rides every message: the Mac agent silently drops frames without it.
 */

import { downsamplePcmFloat32To16k, float32ToInt16Bytes } from "./audio-input";

export interface VoiceAgentCallbacks {
  onStatus(s: "connecting" | "connected" | "disconnected"): void;
  onSpeechStarted(): void;
  onSpeechStopped(): void;
  onTranscriptionDelta(text: string): void;
  onTranscriptionCompleted(text: string): void;
  onResponseCreated(): void;
  onAudioDelta(pcm: ArrayBuffer, sampleRate: number): void;
  onAssistantTranscript(text: string): void;
  /** `turnId` is set when the agent wants a playback_done ack (Mac agent). */
  onResponseDone(status: "completed" | "cancelled", turnId?: number): void;
  onError(message: string): void;
}

type Status = "connecting" | "connected" | "disconnected";

interface AgentEvent {
  type?: string;
  text?: string;
  msg?: string;
  turn_id?: number;
}

interface AgentMessage {
  type?: string;
  event?: AgentEvent;
  data?: string;
  sample_rate?: number;
  turn_id?: number;
  text?: string;
}

export class VoiceAgentClient {
  private readonly wsUrl: string;
  private readonly token: string;
  private readonly callbacks: VoiceAgentCallbacks;
  private readonly outputRate: number;

  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;
  private status: Status = "disconnected";
  private closedByClient = false;
  private authed = false;
  private micPaused = true;
  private speechStarted = false;
  private lastTurnId: number | undefined;
  // ponytail: pipecat streams 40 ms chunks at 2× realtime and AgentOutput
  // chains sources on `onended`, so every chunk boundary is a seam. Coalesce
  // to ~120 ms buffers; the first flushes at 80 ms so the second is already
  // queued before the first ends. Upgrade path: timeline scheduling in
  // AgentOutput → zero seams and −40 ms to first audio.
  private pendingAudio: Uint8Array[] = [];
  private pendingBytes = 0;
  private pendingRate = 0;
  private flushedThisTurn = false;

  constructor(opts: {
    wsUrl: string;
    token: string;
    callbacks: VoiceAgentCallbacks;
    outputRate?: number;
  }) {
    this.wsUrl = opts.wsUrl;
    this.token = opts.token;
    this.callbacks = opts.callbacks;
    // Both agents emit 24 kHz TTS; the audio message carries its rate anyway.
    this.outputRate = opts.outputRate ?? 24000;
  }

  connect(): Promise<void> {
    if (this.authed && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;

    this.closedByClient = false;
    this.authed = false;
    this.setStatus("connecting");

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      let socket: WebSocket;
      try {
        socket = new WebSocket(this.wsUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not open voice agent websocket";
        this.failConnect(message);
        return;
      }

      this.ws = socket;
      socket.onopen = () => this.send({ type: "auth" });
      socket.onmessage = (event) => this.handleMessage(event);
      socket.onerror = () => {
        this.callbacks.onError("Voice agent websocket error");
      };
      socket.onclose = (event) => {
        const wasAuthed = this.authed;
        this.ws = null;
        this.authed = false;
        this.connectPromise = null;
        if (!wasAuthed && !this.closedByClient) {
          this.failConnect(
            `Voice agent closed before authenticating (code ${event.code}) — check VOICE_WS_TOKEN`,
          );
        }
        this.setStatus("disconnected");
      };
    });

    return this.connectPromise;
  }

  close(): void {
    this.closedByClient = true;
    this.authed = false;
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
    // Pre-auth frames are dropped silently by the agent; don't pretend we streamed.
    if (this.micPaused || !this.authed || !frame.length) return;
    const pcm16 = float32ToInt16Bytes(downsamplePcmFloat32To16k(frame, srcRate));
    if (pcm16.byteLength === 0) return;
    this.send({
      type: "audio",
      sample_rate: 16000,
      channels: 1,
      data: arrayBufferToBase64(pcm16),
    });
  }

  setMicPaused(paused: boolean): void {
    this.micPaused = paused;
  }

  /** Deck-side stop. Linux agent routes it through its barge-in path; the Mac agent ignores it (VAD-only cut-off). */
  cancelResponse(): void {
    this.send({ type: "interrupt" });
  }

  /**
   * Interrupts are VAD-driven on the agent; there is no switch. Audio must keep
   * flowing regardless so a spoken approval phrase still reaches ASR.
   */
  setInterruptEnabled(_on: boolean): void {}

  /** Mac agent holds the next turn until the client acks playback of the last one. */
  ackPlayback(turnId: number): void {
    this.send({ type: "playback_done", turn_id: turnId });
  }

  private handleMessage(event: MessageEvent): void {
    let data: AgentMessage;
    try {
      data = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as AgentMessage;
    } catch {
      this.callbacks.onError("Voice agent sent invalid JSON");
      return;
    }

    switch (data.type) {
      case "event":
        this.handleEvent(data.event ?? {});
        return;

      case "audio": {
        if (!data.data) return;
        if (typeof data.turn_id === "number") this.lastTurnId = data.turn_id;
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(base64ToArrayBuffer(data.data));
        } catch {
          this.callbacks.onError("Voice agent sent invalid audio");
          return;
        }
        const rate = data.sample_rate ?? this.outputRate;
        if (rate !== this.pendingRate) this.flushAudio();
        this.pendingRate = rate;
        this.pendingAudio.push(bytes);
        this.pendingBytes += bytes.byteLength;
        const targetMs = this.flushedThisTurn ? 120 : 80;
        if (this.pendingBytes >= (rate * 2 * targetMs) / 1000) this.flushAudio();
        return;
      }

      case "text":
        this.callbacks.onAssistantTranscript(data.text ?? "");
        return;

      default:
        return;
    }
  }

  private handleEvent(ev: AgentEvent): void {
    switch (ev.type) {
      case "authenticated":
        this.authed = true;
        this.setStatus("connected");
        this.connectResolve?.();
        this.connectResolve = null;
        this.connectReject = null;
        return;

      case "vad_start":
        this.markSpeechStarted();
        return;

      case "interrupted":
        // User spoke over the reply and the agent already cut its TTS. Surface
        // as speech-start so the hook tears down local playback the same way.
        this.dropAudio();
        this.markSpeechStarted();
        return;

      case "vad_end":
        // Neither agent is guaranteed to send vad_start; synthesise the start
        // so the FSM still walks listening → transcribing.
        this.markSpeechStarted();
        this.speechStarted = false;
        this.callbacks.onSpeechStopped();
        return;

      case "asr":
        this.callbacks.onTranscriptionCompleted(ev.text ?? "");
        return;

      case "llm_start":
        this.dropAudio();
        this.callbacks.onResponseCreated();
        return;

      case "tts_start":
        if (ev.text) this.callbacks.onAssistantTranscript(ev.text);
        return;

      case "audio_end": {
        // Ordered frame: arrives after the turn's last audio chunk.
        this.flushAudio();
        this.flushedThisTurn = false;
        const turnId = typeof ev.turn_id === "number" ? ev.turn_id : this.lastTurnId;
        this.lastTurnId = undefined;
        this.callbacks.onResponseDone("completed", turnId);
        return;
      }

      case "error":
        this.callbacks.onError(ev.msg ?? "Voice agent error");
        return;

      default:
        return;
    }
  }

  private flushAudio(): void {
    if (this.pendingBytes === 0) return;
    const out = new Uint8Array(this.pendingBytes);
    let offset = 0;
    for (const chunk of this.pendingAudio) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const rate = this.pendingRate;
    this.dropAudio();
    this.flushedThisTurn = true;
    this.callbacks.onAudioDelta(out.buffer, rate);
  }

  private dropAudio(): void {
    this.pendingAudio = [];
    this.pendingBytes = 0;
  }

  private markSpeechStarted(): void {
    if (this.speechStarted) return;
    this.speechStarted = true;
    this.callbacks.onSpeechStarted();
  }

  private send(payload: Record<string, unknown>): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ ...payload, token: this.token }));
  }

  private setStatus(status: Status): void {
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

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
