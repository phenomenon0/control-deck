import { describe, expect, test } from "bun:test";

import { buildSnapshot, type GpuMemory } from "./ledger";
import type { Reservation } from "./types";

const mem: GpuMemory = { totalMb: 24576, usedMb: 8000, freeMb: 16576, source: "nvidia-smi" };

const fakeReservation = (lane: Reservation["lane"], estimateMb: number): Reservation => ({
  ticket: `tk-${lane}`,
  lane,
  estimateMb,
  reason: "test",
  priority: "normal",
  evicts: "none",
  restoreOnIdle: false,
  acquiredAt: 1,
  lastTouchAt: 1,
  ttlMs: 0,
});

describe("buildSnapshot", () => {
  test("returns unknown source when memory read is null", () => {
    const snap = buildSnapshot(null, [], [], 2048);
    expect(snap.source).toBe("unknown");
    expect(snap.totalMb).toBe(0);
    expect(snap.freeMb).toBe(0);
    expect(snap.reserveMb).toBe(2048);
  });

  test("merges memory, processes, reservations", () => {
    const procs = [{ pid: 100, processName: "llama-server", usedMemoryMb: 7000, providerHint: "llamacpp" as const }];
    const reservations = [fakeReservation("chat", 7000)];
    const snap = buildSnapshot(mem, procs, reservations, 2048);
    expect(snap.source).toBe("nvidia-smi");
    expect(snap.totalMb).toBe(24576);
    expect(snap.usedMb).toBe(8000);
    expect(snap.freeMb).toBe(16576);
    expect(snap.processes).toEqual(procs);
    expect(snap.reservations).toEqual(reservations);
    expect(snap.reserveMb).toBe(2048);
  });
});
