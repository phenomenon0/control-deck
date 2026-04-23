import { describe, expect, test } from "bun:test";
import { parseRocmSmi } from "./amd-gpu";

// Real rocm-smi --json output shape (simplified).
const SAMPLE = JSON.stringify({
  card0: {
    "GPU use (%)": "42",
    "VRAM Total Memory (B)": "25757220864",
    "VRAM Total Used Memory (B)": "3221225472",
    "Temperature (Sensor edge) (C)": "58.0",
    "Card series": "Radeon RX 7900 XT",
    "Card model": "0x744c",
    "Card vendor": "Advanced Micro Devices",
  },
});

describe("parseRocmSmi", () => {
  test("extracts the first card's util / VRAM / temp", () => {
    const r = parseRocmSmi(SAMPLE);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Radeon RX 7900 XT");
    expect(r!.utilization).toBe(42);
    expect(r!.memoryTotalMb).toBeGreaterThan(24000); // ~24 GB
    expect(r!.memoryUsedMb).toBe(3072);
    expect(r!.temperatureC).toBe(58);
    expect(r!.memoryPercent).toBeGreaterThan(11);
    expect(r!.memoryPercent).toBeLessThan(13);
  });

  test("returns null on invalid JSON", () => {
    expect(parseRocmSmi("not json")).toBeNull();
  });

  test("returns null when no card0", () => {
    expect(parseRocmSmi(JSON.stringify({ system: {} }))).toBeNull();
  });
});
