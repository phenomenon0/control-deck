import { describe, expect, test } from "bun:test";
import { parsePowermetrics } from "./mac-powermetrics";

const SAMPLE = `
*** Sampled system activity (Tue Apr 22 23:30:00 2026 +0000) (501.02 ms elapsed)

GPU Power: 1234 mW
GPU active frequency: 1398 MHz
CPU Power: 5432 mW
Package Power: 6666 mW
GPU die temperature: 52.02 C (avg)
CPU die temperature: 48.12 C (avg)
`;

describe("parsePowermetrics", () => {
  test("extracts GPU + CPU temps and power", () => {
    const s = parsePowermetrics(SAMPLE);
    expect(s.gpuTempC).toBe(52);
    expect(s.cpuTempC).toBe(48.1);
    expect(s.gpuPowerMw).toBe(1234);
    expect(s.cpuPowerMw).toBe(5432);
  });

  test("returns empty object on blank input", () => {
    expect(parsePowermetrics("")).toEqual({});
  });

  test("tolerates missing CPU side", () => {
    const s = parsePowermetrics("GPU Power: 999 mW\nGPU die temperature: 40.5 C");
    expect(s.gpuPowerMw).toBe(999);
    expect(s.gpuTempC).toBe(40.5);
    expect(s.cpuPowerMw).toBeUndefined();
    expect(s.cpuTempC).toBeUndefined();
  });
});
