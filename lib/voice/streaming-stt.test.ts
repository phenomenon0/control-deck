import { describe, expect, test } from "bun:test";
import { downsamplePcmFloat32To16k, float32ToInt16Bytes } from "./audio-input";

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
    // 0.5 * 0x7fff = 16383.5; the encoder truncates to int → 16383.
    expect(view.getInt16(4, true)).toBe(16383);
  });

  test("output length is 2 × input length (Int16)", () => {
    const buf = float32ToInt16Bytes(new Float32Array(100));
    expect(buf.byteLength).toBe(200);
  });
});
