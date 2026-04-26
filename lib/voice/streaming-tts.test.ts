import { describe, expect, test } from "bun:test";
import { float32ToInt16Bytes } from "./audio-input";
import { int16PcmBytesToFloat32 } from "./streaming-tts";

describe("int16PcmBytesToFloat32", () => {
  test("zero stays zero", () => {
    const buf = new ArrayBuffer(6);
    const out = int16PcmBytesToFloat32(buf);
    expect(out.length).toBe(3);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  test("decodes positive and negative full-scale", () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setInt16(0, 0x7fff, true);
    view.setInt16(2, -0x8000, true);
    const out = int16PcmBytesToFloat32(buf);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(-1, 5);
  });

  test("round-trip preserves Float32 within int16 quantisation", () => {
    const original = new Float32Array([0, 0.25, -0.25, 0.5, -0.75, 1.0, -1.0]);
    const buf = float32ToInt16Bytes(original);
    const decoded = int16PcmBytesToFloat32(buf);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBeCloseTo(original[i], 3);
    }
  });

  test("output length matches sample count", () => {
    const buf = new ArrayBuffer(200);
    const out = int16PcmBytesToFloat32(buf);
    expect(out.length).toBe(100);
  });
});
