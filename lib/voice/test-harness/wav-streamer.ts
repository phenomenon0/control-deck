/**
 * WavStreamer — feed a recorded WAV through the voice pipeline as if a person
 * were speaking it live.
 *
 * Decodes a WAV file (PCM Int16, PCM Int8, IEEE Float32, or A-law/mu-law) into
 * a single Float32 channel, then yields Float32 chunks on a real-time schedule
 * so downstream code (`StreamingSttClient.pushFloat32`, mocked `getUserMedia`)
 * receives audio at the same cadence the WAV would play at — not all at once.
 *
 * The harness uses this to:
 *   1. drive `StreamingSttClient` directly (Bun integration tests)
 *   2. feed a chrome `--use-file-for-fake-audio-capture` flag (Playwright e2e)
 *
 * Pure: no `fs`, no Node APIs. Caller hands in an ArrayBuffer.
 */

export interface WavInfo {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  formatTag: number;
  durationMs: number;
}

const FMT_PCM = 0x0001;
const FMT_FLOAT = 0x0003;
const FMT_ALAW = 0x0006;
const FMT_MULAW = 0x0007;
const FMT_EXTENSIBLE = 0xfffe;

/** Decode a RIFF/WAVE file into a mono Float32 buffer + metadata. */
export function decodeWav(buf: ArrayBuffer): WavInfo {
  const view = new DataView(buf);
  if (view.byteLength < 44) throw new Error("wav too small");
  const riff = readAscii(view, 0, 4);
  const wave = readAscii(view, 8, 4);
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error("not a RIFF/WAVE file");

  let fmtOffset = -1;
  let fmtSize = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let cursor = 12;
  while (cursor + 8 <= view.byteLength) {
    const id = readAscii(view, cursor, 4);
    const size = view.getUint32(cursor + 4, true);
    if (id === "fmt ") {
      fmtOffset = cursor + 8;
      fmtSize = size;
    } else if (id === "data") {
      dataOffset = cursor + 8;
      dataSize = size;
      break;
    }
    cursor += 8 + size + (size % 2);
  }
  if (fmtOffset < 0 || dataOffset < 0) throw new Error("missing fmt/data chunk");

  let formatTag = view.getUint16(fmtOffset, true);
  const channels = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const bitDepth = view.getUint16(fmtOffset + 14, true);

  if (formatTag === FMT_EXTENSIBLE && fmtSize >= 24) {
    formatTag = view.getUint16(fmtOffset + 24, true);
  }

  const totalSamples = sampleRate > 0
    ? Math.floor(dataSize / (channels * Math.max(1, bitDepth / 8)))
    : 0;
  const mono = new Float32Array(totalSamples);

  const sampleBytes = bitDepth / 8;
  const frameBytes = channels * sampleBytes;

  for (let i = 0; i < totalSamples; i++) {
    let sum = 0;
    const frameOff = dataOffset + i * frameBytes;
    for (let c = 0; c < channels; c++) {
      sum += readSample(view, frameOff + c * sampleBytes, formatTag, bitDepth);
    }
    mono[i] = sum / Math.max(1, channels);
  }

  const durationMs = sampleRate > 0 ? (totalSamples / sampleRate) * 1000 : 0;
  return { samples: mono, sampleRate, channels, bitDepth, formatTag, durationMs };
}

function readSample(view: DataView, offset: number, formatTag: number, bitDepth: number): number {
  if (formatTag === FMT_PCM) {
    if (bitDepth === 16) return view.getInt16(offset, true) / 0x8000;
    if (bitDepth === 8) return (view.getUint8(offset) - 128) / 128;
    if (bitDepth === 24) {
      const b0 = view.getUint8(offset);
      const b1 = view.getUint8(offset + 1);
      const b2 = view.getInt8(offset + 2);
      const v = (b2 << 16) | (b1 << 8) | b0;
      return v / 0x800000;
    }
    if (bitDepth === 32) return view.getInt32(offset, true) / 0x80000000;
  }
  if (formatTag === FMT_FLOAT && bitDepth === 32) return view.getFloat32(offset, true);
  if (formatTag === FMT_MULAW && bitDepth === 8) return mulawToFloat(view.getUint8(offset));
  if (formatTag === FMT_ALAW && bitDepth === 8) return alawToFloat(view.getUint8(offset));
  throw new Error(`unsupported format tag=${formatTag} bitDepth=${bitDepth}`);
}

function mulawToFloat(b: number): number {
  b = ~b & 0xff;
  const sign = b & 0x80 ? -1 : 1;
  const exponent = (b >> 4) & 0x07;
  const mantissa = b & 0x0f;
  const magnitude = ((mantissa << 1) | 0x21) << (exponent + 2);
  return (sign * (magnitude - 0x84)) / 0x8000;
}

function alawToFloat(b: number): number {
  b = (b ^ 0x55) & 0xff;
  const sign = b & 0x80 ? -1 : 1;
  const exponent = (b >> 4) & 0x07;
  const mantissa = b & 0x0f;
  let magnitude: number;
  if (exponent === 0) magnitude = (mantissa << 4) + 8;
  else magnitude = ((mantissa << 4) + 0x108) << (exponent - 1);
  return (sign * magnitude) / 0x8000;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

export interface WavStreamerOptions {
  /** Milliseconds per chunk. Default 100ms ~= MediaRecorder cadence. */
  chunkMs?: number;
  /** If true, sleep between chunks so emission matches WAV duration. Default true. */
  realTime?: boolean;
  /** Optional rate multiplier; 1.0 = real time. Useful in tests (10.0 = 10× faster). */
  speed?: number;
  /** Optional callback fired exactly once when the first chunk yields. */
  onFirstChunk?: () => void;
}

/** Yield Float32 chunks of `samples` paced like a real speaker. */
export async function* streamWavChunks(
  info: WavInfo,
  opts: WavStreamerOptions = {},
): AsyncGenerator<{ samples: Float32Array; sampleRate: number; index: number; t: number }, void, void> {
  const chunkMs = opts.chunkMs ?? 100;
  const realTime = opts.realTime ?? true;
  const speed = opts.speed ?? 1;
  const samplesPerChunk = Math.max(1, Math.round((info.sampleRate * chunkMs) / 1000));
  const start = performance.now();
  let idx = 0;
  let firstFired = false;
  for (let off = 0; off < info.samples.length; off += samplesPerChunk) {
    const end = Math.min(info.samples.length, off + samplesPerChunk);
    const slice = info.samples.subarray(off, end);
    if (realTime && idx > 0) {
      const targetT = (idx * chunkMs) / speed;
      const now = performance.now() - start;
      const wait = targetT - now;
      if (wait > 0) await sleep(wait);
    }
    if (!firstFired) {
      firstFired = true;
      opts.onFirstChunk?.();
    }
    yield { samples: slice, sampleRate: info.sampleRate, index: idx, t: performance.now() - start };
    idx++;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
