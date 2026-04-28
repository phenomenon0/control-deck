import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { downsamplePcmFloat32To16k, float32ToInt16Bytes } from "./audio-input";
import { StreamingSttClient } from "./streaming-stt";

// ============================================================================
// audio-input helpers (kept from original test file)
// ============================================================================

describe("downsamplePcmFloat32To16k", () => {
  test("identity at 16 kHz", () => {
    const frame = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const out = downsamplePcmFloat32To16k(frame, 16000);
    expect(out).toBe(frame);
  });

  test("48 kHz → 16 kHz collapses 3:1", () => {
    const frame = new Float32Array([1, 1, 1, 0, 0, 0, 0.5, 0.5, 0.5]);
    const out = downsamplePcmFloat32To16k(frame, 48000);
    expect(out.length).toBe(3);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(0.5, 5);
  });

  test("44.1 kHz → 16 kHz produces fewer samples", () => {
    const frame = new Float32Array(441);
    frame.fill(0.5);
    const out = downsamplePcmFloat32To16k(frame, 44100);
    expect(out.length).toBeLessThan(frame.length);
    expect(out[0]).toBeCloseTo(0.5, 3);
  });

  test("returns input unchanged when src is below 16 kHz", () => {
    const frame = new Float32Array([0.1, 0.2, 0.3]);
    const out = downsamplePcmFloat32To16k(frame, 8000);
    expect(out).toBe(frame);
  });
});

describe("float32ToInt16Bytes", () => {
  test("zero stays zero", () => {
    const buf = float32ToInt16Bytes(new Float32Array([0, 0, 0]));
    const view = new DataView(buf);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0);
    expect(view.getInt16(4, true)).toBe(0);
  });

  test("clips out-of-range values", () => {
    const buf = float32ToInt16Bytes(new Float32Array([1.5, -1.5]));
    const view = new DataView(buf);
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x8000);
  });

  test("encodes positive and negative full-scale", () => {
    const buf = float32ToInt16Bytes(new Float32Array([1.0, -1.0, 0.5]));
    const view = new DataView(buf);
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x8000);
    expect(view.getInt16(4, true)).toBe(16383);
  });

  test("output length is 2 × input length (Int16)", () => {
    const buf = float32ToInt16Bytes(new Float32Array(100));
    expect(buf.byteLength).toBe(200);
  });
});

// ============================================================================
// StreamingSttClient — pre-handshake buffering, op queueing, close semantics
// ============================================================================

interface FakeWS {
  readyState: number;
  binaryType: string;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  sent: unknown[];
  send(data: unknown): void;
  close(): void;
}

let lastFakeWs: FakeWS | null = null;
const realWebSocket = globalThis.WebSocket;

function installFakeWs() {
  // Minimal fake. The client only uses CONSTANTS, readyState, binaryType,
  // onmessage, onerror, onclose, send, and close.
  const FakeWebSocket = function FakeWebSocket(this: FakeWS) {
    this.readyState = 0; // CONNECTING
    this.binaryType = "blob";
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.sent = [];
    this.send = (data: unknown) => {
      this.sent.push(data);
    };
    this.close = () => {
      this.readyState = 3;
      this.onclose?.();
    };
    lastFakeWs = this;
  } as unknown as { new (url: string): FakeWS } & typeof WebSocket;

  // Reproduce the WebSocket numeric constants the client checks.
  Object.assign(FakeWebSocket, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
}

function restoreWs() {
  globalThis.WebSocket = realWebSocket;
  lastFakeWs = null;
}

/** Simulate the server: open the socket and emit a `ready` JSON frame. */
function fireReady(ws: FakeWS) {
  ws.readyState = 1;
  ws.onmessage?.({
    data: JSON.stringify({ type: "ready", engine: "test", sampleRate: 16000 }),
  });
}

describe("StreamingSttClient — pre-handshake buffering", () => {
  beforeEach(() => {
    installFakeWs();
  });
  afterEach(() => {
    restoreWs();
  });

  test("frames pushed before ready are buffered, then drained on ready", () => {
    const client = new StreamingSttClient({ baseUrl: "ws://x" });
    void client.connect();

    expect(lastFakeWs).not.toBeNull();
    const ws = lastFakeWs!;

    // Push 3 frames while still CONNECTING. Client must NOT drop them.
    client.pushPcm16(new Uint8Array([1, 2, 3, 4]).buffer);
    client.pushPcm16(new Uint8Array([5, 6, 7, 8]).buffer);
    client.pushPcm16(new Uint8Array([9, 10, 11, 12]).buffer);

    expect(ws.sent.length).toBe(0); // still buffered
    expect(client.pendingFrameBytes()).toBe(12);

    fireReady(ws);

    // After ready, all 3 frames are flushed in order.
    expect(ws.sent.length).toBe(3);
    expect(client.pendingFrameBytes()).toBe(0);
  });

  test("ops queued before ready (final/flush) are sent in order after ready", () => {
    const client = new StreamingSttClient({ baseUrl: "ws://x" });
    void client.connect();
    const ws = lastFakeWs!;

    client.pushPcm16(new Uint8Array([1, 2]).buffer);
    client.flush();
    client.final();

    expect(ws.sent.length).toBe(0);

    fireReady(ws);

    // 1 binary frame, then 2 string ops in order.
    expect(ws.sent.length).toBe(3);
    expect(typeof ws.sent[0]).not.toBe("string"); // binary
    expect(ws.sent[1]).toBe(JSON.stringify({ op: "flush" }));
    expect(ws.sent[2]).toBe(JSON.stringify({ op: "final" }));
  });

  test("oldest frames drop when pre-handshake buffer exceeds cap", () => {
    const client = new StreamingSttClient({ baseUrl: "ws://x", preopenFrameCapBytes: 8 });
    void client.connect();
    const ws = lastFakeWs!;

    client.pushPcm16(new Uint8Array([1, 1, 1, 1]).buffer); // 4 bytes
    client.pushPcm16(new Uint8Array([2, 2, 2, 2]).buffer); // 4 bytes (total 8)
    client.pushPcm16(new Uint8Array([3, 3, 3, 3]).buffer); // 4 bytes — oldest must drop

    expect(client.pendingFrameBytes()).toBeLessThanOrEqual(8);

    fireReady(ws);

    // Three original frames; oldest (1,1,1,1) is gone, the two newest survive.
    expect(ws.sent.length).toBe(2);
    const second = new Uint8Array(ws.sent[0] as ArrayBuffer);
    const third = new Uint8Array(ws.sent[1] as ArrayBuffer);
    expect(second[0]).toBe(2);
    expect(third[0]).toBe(3);
  });

  test("close() drops all pending frames and silences subsequent pushes", () => {
    const client = new StreamingSttClient({ baseUrl: "ws://x" });
    void client.connect();
    const ws = lastFakeWs!;

    client.pushPcm16(new Uint8Array([1, 2, 3, 4]).buffer);
    client.close();

    // Buffered frames cleared.
    expect(client.pendingFrameBytes()).toBe(0);

    // Further pushes after close are silent no-ops.
    client.pushPcm16(new Uint8Array([5, 6]).buffer);
    expect(client.pendingFrameBytes()).toBe(0);

    // Even if some race delivered a `ready` after close, nothing should send.
    ws.readyState = 1;
    ws.onmessage?.({ data: JSON.stringify({ type: "ready", sampleRate: 16000 }) });
    expect(ws.sent.length).toBe(0);
  });

  test("after ready, frames are sent immediately (no buffering)", () => {
    const client = new StreamingSttClient({ baseUrl: "ws://x" });
    void client.connect();
    const ws = lastFakeWs!;
    fireReady(ws);

    client.pushPcm16(new Uint8Array([7, 7]).buffer);
    expect(ws.sent.length).toBe(1);
    expect(client.pendingFrameBytes()).toBe(0);
  });

  test("connect() after close() rejects (no zombie reconnect)", async () => {
    const client = new StreamingSttClient({ baseUrl: "ws://x" });
    void client.connect();
    const ws = lastFakeWs!;
    fireReady(ws);
    client.close();

    let threw = false;
    try {
      await client.connect();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("onclose during handshake clears pending so they don't leak", () => {
    const client = new StreamingSttClient({ baseUrl: "ws://x" });
    void client.connect();
    const ws = lastFakeWs!;

    client.pushPcm16(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(client.pendingFrameBytes()).toBe(4);

    // Server hangs up before sending `ready`.
    ws.onclose?.();
    expect(client.pendingFrameBytes()).toBe(0);
  });
});
