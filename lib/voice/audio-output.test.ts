/**
 * AgentOutput tests — focused on the handle queue and per-handle event fan-out.
 *
 * Bun's runtime has no Web Audio API, so this file installs a minimal mock of
 * `AudioContext` that records source nodes and exposes their `.onended` so the
 * test can deterministically simulate buffer playback ending.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AgentOutput } from "./audio-output";
import { SpeechHandle } from "./speech-handle";

// ============================================================================
// Minimal AudioContext mock
// ============================================================================

interface FakeNode {
  connect(): FakeNode;
  disconnect(target?: FakeNode): void;
}

interface FakeBufferSource extends FakeNode {
  buffer: unknown;
  onended: (() => void) | null;
  start(_when?: number): void;
  stop(): void;
  __started: boolean;
  __stopped: boolean;
}

interface FakeAudioContext {
  state: "suspended" | "running" | "closed";
  sampleRate: number;
  destination: FakeNode;
  createGain(): FakeNode & { gain: { value: number } };
  createDynamicsCompressor(): FakeNode & { threshold: { value: number }; knee: { value: number }; ratio: { value: number }; attack: { value: number }; release: { value: number } };
  createBiquadFilter(): FakeNode & { type: string; frequency: { value: number }; Q: { value: number }; gain: { value: number } };
  createConvolver(): FakeNode & { buffer: unknown };
  createBuffer(channels: number, length: number, rate: number): { getChannelData(ch: number): Float32Array; numberOfChannels: number; length: number; sampleRate: number };
  createBufferSource(): FakeBufferSource;
  createMediaStreamDestination(): FakeNode & { stream: unknown };
  resume(): Promise<void>;
  close(): Promise<void>;
}

let createdSources: FakeBufferSource[] = [];

function makeNode(): FakeNode {
  return {
    connect(): FakeNode {
      return this;
    },
    disconnect(): void {},
  };
}

function makeFakeContext(): FakeAudioContext {
  const node = (): FakeNode & { gain: { value: number } } => ({
    ...makeNode(),
    gain: { value: 0 },
  });
  return {
    state: "running",
    sampleRate: 48000,
    destination: makeNode(),
    createGain: () => node(),
    createDynamicsCompressor: () => ({
      ...makeNode(),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    }),
    createBiquadFilter: () => ({
      ...makeNode(),
      type: "peaking",
      frequency: { value: 0 },
      Q: { value: 0 },
      gain: { value: 0 },
    }),
    createConvolver: () => ({ ...makeNode(), buffer: null }),
    createBuffer: (channels: number, length: number, rate: number) => {
      const channelData: Float32Array[] = [];
      for (let i = 0; i < channels; i++) channelData.push(new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        getChannelData: (ch: number) => channelData[ch],
      };
    },
    createBufferSource: () => {
      const src: FakeBufferSource = {
        ...makeNode(),
        buffer: null,
        onended: null,
        __started: false,
        __stopped: false,
        start() {
          this.__started = true;
        },
        stop() {
          this.__stopped = true;
        },
      };
      createdSources.push(src);
      return src;
    },
    createMediaStreamDestination: () => ({ ...makeNode(), stream: {} }),
    resume: async () => {},
    close: async () => {},
  };
}

let originalAudioContext: unknown;

beforeEach(() => {
  createdSources = [];
  originalAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
  (globalThis as { AudioContext?: unknown }).AudioContext =
    function FakeAudioContextCtor() {
      return makeFakeContext();
    } as unknown as typeof AudioContext;
});

afterEach(() => {
  (globalThis as { AudioContext?: unknown }).AudioContext = originalAudioContext;
});

// Tiny PCM payload — 4 samples, Int16 LE. Content doesn't matter for queue tests.
function tinyPcm(): ArrayBuffer {
  return new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0]).buffer;
}

// Tick microtasks until a condition holds, with a frame budget so a stuck test
// fails fast instead of hanging the runner.
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ============================================================================
// Tests
// ============================================================================

describe("AgentOutput — handle queue (was: 2nd utterance silently dropped)", () => {
  test("a second handle that arrives during active playback plays after the first drains", async () => {
    const out = new AgentOutput();
    const speechEnded: number[] = [];
    out.on("speechEnd", ({ handle }) => speechEnded.push(handle.id));

    const handleA = new SpeechHandle(1);
    const handleB = new SpeechHandle(2);

    // Handle A: send a chunk + finish.
    await out.playPcm16Chunk(handleA, tinyPcm(), 16000);
    await out.finish(handleA);

    // While A's first source is still "playing" (hasn't fired onended yet),
    // handle B sends its first chunk + finish.
    await out.playPcm16Chunk(handleB, tinyPcm(), 16000);
    await out.finish(handleB);

    // Exactly one source should be playing right now (handle A's).
    expect(createdSources.length).toBe(1);
    expect(createdSources[0]?.__started).toBe(true);

    // Simulate A's audio finishing.
    createdSources[0]?.onended?.();
    await flush();

    // Handle A's speechEnd should now have fired, and B's source should have
    // started — proving the queued handle was promoted instead of being dropped.
    expect(speechEnded).toContain(handleA.id);
    expect(createdSources.length).toBe(2);
    expect(createdSources[1]?.__started).toBe(true);

    // Finish B's playback.
    createdSources[1]?.onended?.();
    await flush();
    expect(speechEnded).toContain(handleB.id);
  });

  test("speechStart fires exactly once per handle, even with multiple chunks", async () => {
    const out = new AgentOutput();
    const starts: number[] = [];
    out.on("speechStart", ({ handle }) => starts.push(handle.id));

    const h = new SpeechHandle(1);
    await out.playPcm16Chunk(h, tinyPcm(), 16000);
    await out.playPcm16Chunk(h, tinyPcm(), 16000);
    await out.playPcm16Chunk(h, tinyPcm(), 16000);

    // First chunk plays now; the rest are queued in handle.buffers.
    expect(createdSources.length).toBe(1);
    expect(starts).toEqual([h.id]);

    // Drain chunk-by-chunk; speechStart must NOT fire again.
    createdSources[0]?.onended?.();
    await flush();
    expect(createdSources.length).toBe(2);
    createdSources[1]?.onended?.();
    await flush();
    expect(createdSources.length).toBe(3);

    expect(starts).toEqual([h.id]); // still exactly one
  });

  test("interrupting the active handle promotes the queued handle", async () => {
    const out = new AgentOutput();
    const ended: number[] = [];
    out.on("speechEnd", ({ handle }) => ended.push(handle.id));

    const a = new SpeechHandle(1);
    const b = new SpeechHandle(2);

    await out.playPcm16Chunk(a, tinyPcm(), 16000);
    await out.playPcm16Chunk(b, tinyPcm(), 16000);

    // a is active, b queued.
    expect(createdSources.length).toBe(1);

    out.interrupt(a, "user");
    await flush();

    // b's source should now be playing.
    expect(a.state).toBe("interrupted");
    expect(ended).toContain(a.id);
    expect(createdSources.length).toBe(2);
    expect(createdSources[1]?.__started).toBe(true);
  });

  test("interrupting a queued handle removes it without affecting the active one", async () => {
    const out = new AgentOutput();
    const ended: number[] = [];
    out.on("speechEnd", ({ handle }) => ended.push(handle.id));

    const a = new SpeechHandle(1);
    const b = new SpeechHandle(2);

    await out.playPcm16Chunk(a, tinyPcm(), 16000);
    await out.playPcm16Chunk(b, tinyPcm(), 16000);
    expect(createdSources.length).toBe(1);

    out.interrupt(b, "drop");
    await flush();

    // b is interrupted but a's source is still playing — nothing was promoted.
    expect(b.state).toBe("interrupted");
    expect(a.state).toBe("speaking");
    // a's source must still be the only/current one.
    expect(createdSources.length).toBe(1);
    expect(createdSources[0]?.__stopped).toBeFalsy();
  });

  test("stopAll() clears the active handle AND the queue", async () => {
    const out = new AgentOutput();
    const ended: number[] = [];
    out.on("speechEnd", ({ handle }) => ended.push(handle.id));

    const a = new SpeechHandle(1);
    const b = new SpeechHandle(2);
    const c = new SpeechHandle(3);

    await out.playPcm16Chunk(a, tinyPcm(), 16000);
    await out.playPcm16Chunk(b, tinyPcm(), 16000);
    await out.playPcm16Chunk(c, tinyPcm(), 16000);

    out.stopAll();
    await flush();

    expect(a.state).toBe("interrupted");
    expect(b.state).toBe("interrupted");
    expect(c.state).toBe("interrupted");
    expect(ended).toContain(a.id);
    expect(ended).toContain(b.id);
    expect(ended).toContain(c.id);
  });
});
