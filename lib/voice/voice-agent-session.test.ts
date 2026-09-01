/**
 * Pins the wire contract with the voice agents. Each case names the agent
 * behaviour that would silently break the session if the client drifted.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { VoiceAgentClient, type VoiceAgentCallbacks } from "./voice-agent-session";

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  // test-side helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  recv(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  event(event: Record<string, unknown>) {
    this.recv({ type: "event", event });
  }
  lastSent() {
    return JSON.parse(this.sent[this.sent.length - 1]!) as Record<string, unknown>;
  }
}

const realWebSocket = globalThis.WebSocket;

function calls() {
  const log: Array<[string, ...unknown[]]> = [];
  const cb = new Proxy({} as VoiceAgentCallbacks, {
    get: (_t, name: string) => (...args: unknown[]) => log.push([name, ...args]),
  });
  return { cb, log, named: (n: string) => log.filter((c) => c[0] === n) };
}

async function authed() {
  const c = calls();
  const client = new VoiceAgentClient({ wsUrl: "ws://x", token: "tok", callbacks: c.cb });
  const p = client.connect();
  const sock = FakeSocket.last!;
  sock.open();
  sock.event({ type: "authenticated" });
  await p;
  return { client, sock, ...c };
}

describe("VoiceAgentClient", () => {
  beforeEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
  });
  afterEach(() => {
    globalThis.WebSocket = realWebSocket;
  });

  test("auth is the first frame; connect resolves only on `authenticated`", async () => {
    const { sock, named } = await authed();
    expect(JSON.parse(sock.sent[0]!)).toEqual({ type: "auth", token: "tok" });
    expect(named("onStatus").map((c) => c[1])).toEqual(["connecting", "connected"]);
  });

  test("mic frames carry the per-message token and 16 kHz pcm16; nothing is sent pre-auth", async () => {
    const c = calls();
    const client = new VoiceAgentClient({ wsUrl: "ws://x", token: "tok", callbacks: c.cb });
    const p = client.connect();
    const sock = FakeSocket.last!;
    sock.open();
    client.setMicPaused(false);
    client.appendAudio(new Float32Array(320).fill(0.5), 16000);
    // Agent drops pre-auth frames silently — the client must not stream yet.
    expect(sock.sent).toHaveLength(1);
    sock.event({ type: "authenticated" });
    await p;
    client.appendAudio(new Float32Array(320).fill(0.5), 16000);
    const msg = sock.lastSent();
    expect(msg.type).toBe("audio");
    expect(msg.sample_rate).toBe(16000);
    expect(msg.channels).toBe(1);
    expect(msg.token).toBe("tok"); // Mac agent silently drops untokened frames
    expect(atob(msg.data as string).length).toBe(640);
  });

  test("vad_end synthesises a missing speech-start; vad_start never double-fires", async () => {
    const { sock, named } = await authed();
    sock.event({ type: "vad_start" });
    sock.event({ type: "vad_end" });
    expect(named("onSpeechStarted")).toHaveLength(1);
    expect(named("onSpeechStopped")).toHaveLength(1);
    sock.event({ type: "vad_end" }); // Mac agent: no vad_start at all
    expect(named("onSpeechStarted")).toHaveLength(2);
    expect(named("onSpeechStopped")).toHaveLength(2);
  });

  test("asr → transcript, llm_start → response, audio coalesced (80 ms then 120 ms), audio_end flushes the tail and carries the turn id", async () => {
    const { client, sock, named } = await authed();
    sock.event({ type: "asr", text: "hi there", asr_ms: 120 });
    sock.event({ type: "llm_start" });
    // pipecat: 40 ms chunks @ 24 kHz pcm16 = 1920 bytes each.
    const chunk = btoa(String.fromCharCode(...new Uint8Array(1920)));
    const audio = (turn_id: number) => sock.recv({ type: "audio", sample_rate: 24000, channels: 1, data: chunk, turn_id });
    audio(7);
    expect(named("onAudioDelta")).toHaveLength(0); // one chunk alone would leave a seam behind it
    audio(7);
    expect(named("onAudioDelta")).toHaveLength(1); // 80 ms: play now, next batch lands before this ends
    audio(7); audio(7);
    expect(named("onAudioDelta")).toHaveLength(1);
    audio(7);
    expect(named("onAudioDelta")).toHaveLength(2); // 120 ms batches after the first
    audio(7);
    sock.event({ type: "audio_end" });
    const deltas = named("onAudioDelta");
    expect(deltas).toHaveLength(3); // tail flushed before done
    expect(deltas.map((d) => (d[1] as ArrayBuffer).byteLength)).toEqual([3840, 5760, 1920]);
    expect(deltas[0]![2]).toBe(24000);
    expect(named("onTranscriptionCompleted")[0]![1]).toBe("hi there");
    expect(named("onResponseCreated")).toHaveLength(1);
    expect(named("onResponseDone")[0]!.slice(1)).toEqual(["completed", 7]);
    client.ackPlayback(7);
    expect(sock.lastSent()).toEqual({ type: "playback_done", turn_id: 7, token: "tok" });
  });

  test("interrupted = user spoke over the reply → speech-start; error → onError", async () => {
    const { sock, named } = await authed();
    sock.event({ type: "interrupted" });
    expect(named("onSpeechStarted")).toHaveLength(1);
    sock.event({ type: "error", msg: "asr: boom" });
    expect(named("onError")[0]![1]).toBe("asr: boom");
  });

  test("socket closed before auth rejects connect and names the close code", async () => {
    const c = calls();
    const client = new VoiceAgentClient({ wsUrl: "ws://x", token: "bad", callbacks: c.cb });
    const p = client.connect();
    const sock = FakeSocket.last!;
    sock.open();
    sock.readyState = 3;
    sock.onclose?.({ code: 4001 });
    await expect(p).rejects.toThrow(/4001/);
  });
});
