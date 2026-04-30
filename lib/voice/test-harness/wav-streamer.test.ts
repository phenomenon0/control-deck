import { describe, expect, test } from "bun:test";

import { decodeWav, streamWavChunks, type WavInfo } from "./wav-streamer";

function pcm16Wav(samples: Int16Array, sampleRate: number, channels = 1): ArrayBuffer {
  const dataBytes = samples.byteLength;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return buf;
}

function writeAscii(view: DataView, off: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
}

describe("decodeWav", () => {
  test("decodes PCM16 mono with correct sample count + duration", () => {
    const sr = 16000;
    const total = sr; // 1s
    const ints = new Int16Array(total);
    for (let i = 0; i < total; i++) ints[i] = Math.round(Math.sin((i / sr) * 2 * Math.PI * 440) * 0x7fff);
    const info = decodeWav(pcm16Wav(ints, sr));
    expect(info.sampleRate).toBe(sr);
    expect(info.channels).toBe(1);
    expect(info.bitDepth).toBe(16);
    expect(info.samples.length).toBe(total);
    expect(Math.round(info.durationMs)).toBe(1000);
    expect(info.samples[0]).toBeCloseTo(0, 2);
  });

  test("downmixes stereo PCM16 to mono", () => {
    const sr = 8000;
    const frames = 4;
    const ints = new Int16Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      ints[i * 2] = 0x4000;
      ints[i * 2 + 1] = -0x4000;
    }
    const info = decodeWav(pcm16Wav(ints, sr, 2));
    expect(info.channels).toBe(2);
    expect(info.samples.length).toBe(frames);
    for (const s of info.samples) expect(Math.abs(s)).toBeLessThan(0.001);
  });

  test("rejects non-RIFF input cleanly", () => {
    const buf = new ArrayBuffer(64);
    expect(() => decodeWav(buf)).toThrow();
  });
});

describe("streamWavChunks", () => {
  function fakeInfo(durationMs: number, sampleRate = 16000): WavInfo {
    const totalSamples = Math.round((sampleRate * durationMs) / 1000);
    return {
      samples: new Float32Array(totalSamples),
      sampleRate,
      channels: 1,
      bitDepth: 16,
      formatTag: 1,
      durationMs,
    };
  }

  test("emits chunks with size ~ chunkMs * sampleRate / 1000", async () => {
    const info = fakeInfo(500);
    const chunks: number[] = [];
    for await (const c of streamWavChunks(info, { chunkMs: 100, realTime: false })) {
      chunks.push(c.samples.length);
    }
    expect(chunks.length).toBe(5);
    for (const len of chunks) expect(len).toBe(1600);
  });

  test("chunked total equals input length", async () => {
    const info = fakeInfo(317);
    let total = 0;
    for await (const c of streamWavChunks(info, { chunkMs: 50, realTime: false })) total += c.samples.length;
    expect(total).toBe(info.samples.length);
  });

  test("real-time pacing approximately matches WAV duration", async () => {
    const info = fakeInfo(300);
    const start = performance.now();
    for await (const _ of streamWavChunks(info, { chunkMs: 100, realTime: true, speed: 1 })) { /* drain */ }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThan(180);
    expect(elapsed).toBeLessThan(450);
  });

  test("speed multiplier compresses pacing", async () => {
    const info = fakeInfo(500);
    const start = performance.now();
    for await (const _ of streamWavChunks(info, { chunkMs: 100, realTime: true, speed: 10 })) { /* drain */ }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(150);
  });

  test("onFirstChunk fires exactly once on first yield", async () => {
    const info = fakeInfo(300);
    let count = 0;
    for await (const _ of streamWavChunks(info, { chunkMs: 100, realTime: false, onFirstChunk: () => { count++; } })) { /* drain */ }
    expect(count).toBe(1);
  });
});
