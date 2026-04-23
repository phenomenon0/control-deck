/**
 * ioreg parser tests — pure text-in/object-out, no shell dependency.
 * Sample was captured from an actual Apple M3 via:
 *   ioreg -r -c IOAccelerator -w0
 */

import { describe, expect, test } from "bun:test";
import { parseIoreg } from "./mac-gpu";

// Minimal but realistic snippet from a real M3.
const M3_SAMPLE = `
  |   "GPURawCounterPluginClassName" = "AGXGPURawCounterSourceGroup"
  |   "MetalPluginClassName" = "AGXG15GDevice"
  |   "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=5198708736,"Tiler Utilization %"=27,"recoveryCount"=0,"lastRecoveryTime"=0,"Renderer Utilization %"=26,"TiledSceneBytes"=917504,"Device Utilization %"=27,"SplitSceneCount"=0,"Allocated PB Size"=153092096,"In use system memory"=1226113024}
  |   "IOProviderClass" = "AppleARMIODevice"
  |   "IOClass" = "AGXAcceleratorG15G"
`;

describe("parseIoreg", () => {
  test("parses an M3 AGX snapshot", () => {
    const r = parseIoreg(M3_SAMPLE);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Apple G15G");
    expect(r!.utilization).toBe(27);
    expect(r!.renderer).toBe(26);
    expect(r!.tiler).toBe(27);
    expect(r!.inUseBytes).toBe(1_226_113_024);
    expect(r!.allocBytes).toBe(5_198_708_736);
  });

  test("returns null when PerformanceStatistics absent", () => {
    expect(parseIoreg("some other ioreg output")).toBeNull();
  });

  test("derives a friendly name when IOClass lacks the prefix", () => {
    const r = parseIoreg(`"IOClass" = "Other"\n"Device Utilization %"=5`);
    expect(r?.name).toBe("Apple GPU");
  });

  test("handles zero utilisation cleanly", () => {
    const r = parseIoreg(
      `"IOClass" = "AGXAcceleratorG13G"\n"Device Utilization %"=0,"In use system memory"=0,"Alloc system memory"=0`,
    );
    expect(r!.utilization).toBe(0);
    expect(r!.inUseBytes).toBe(0);
  });
});
