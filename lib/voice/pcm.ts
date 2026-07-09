/** Convert Int16 LE PCM bytes to Float32 samples in [-1, 1]. */
export function int16PcmBytesToFloat32(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const samples = Math.floor(buf.byteLength / 2);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}
