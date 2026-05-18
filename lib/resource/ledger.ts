/**
 * VRAM ledger — the single source of truth for "how much VRAM is free
 * right now and which processes are holding it".
 *
 * Reads come from two collectors:
 *   - NVIDIA: `nvidia-smi --query-gpu=memory.total,memory.used,memory.free
 *             --format=csv,noheader,nounits` (single number per field, MB).
 *   - macOS:  total = `sysctl hw.memsize`; "free" is approximated as
 *             `vm_stat` free+inactive pages × page size. Process list reuses
 *             `lib/hardware/gpu-processes.ts` parsePsOutput.
 *
 * Per-process VRAM comes from `collectGpuProcesses()` (already implemented).
 *
 * Server-side only — imports node:child_process.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

import { collectGpuProcesses } from "@/lib/hardware/gpu-processes";
import type { GpuProcess } from "@/lib/hardware/gpu-types";

import { attachProcessMemory, collectKvCaches } from "./kv-cache";
import type {
  KvCacheTelemetry,
  LedgerSnapshot,
  Reservation,
  ResourceEvent,
  ResourceEventListener,
} from "./types";

const execAsync = promisify(exec);

const DEFAULT_RESERVE_MB = (() => {
  const raw = process.env.DECK_VRAM_RESERVE_MB;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 2048;
})();

const POLL_INTERVAL_MS = (() => {
  const raw = process.env.DECK_RESOURCE_POLL_MS;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 250) return n;
  }
  return 2000;
})();

/**
 * Raw GPU memory read. Returns null if no GPU is detected (caller should
 * fall back to RAM-proxy on darwin or report `unknown`).
 */
export interface GpuMemory {
  totalMb: number;
  usedMb: number;
  freeMb: number;
  source: "nvidia-smi" | "ps-rss" | "unknown";
}

export async function readGpuMemory(): Promise<GpuMemory | null> {
  if (process.platform === "darwin") {
    return readDarwinMemory();
  }
  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits",
      { timeout: 2000 },
    );
    const line = stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
    if (!line) return null;
    const parts = line.split(",").map((s) => Number.parseInt(s.trim(), 10));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [totalMb, usedMb, freeMb] = parts;
    return { totalMb, usedMb, freeMb, source: "nvidia-smi" };
  } catch {
    return null;
  }
}

async function readDarwinMemory(): Promise<GpuMemory | null> {
  try {
    const total = await execAsync("sysctl -n hw.memsize", { timeout: 1000 });
    const totalBytes = Number.parseInt(total.stdout.trim(), 10);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    // vm_stat reports pages; default page size on Apple Silicon is 16 KB.
    const vm = await execAsync("vm_stat", { timeout: 1000 });
    const pageMatch = /page size of (\d+) bytes/.exec(vm.stdout);
    const pageSize = pageMatch ? Number.parseInt(pageMatch[1], 10) : 16_384;
    const freePages = matchVmStat(vm.stdout, "Pages free");
    const inactivePages = matchVmStat(vm.stdout, "Pages inactive");
    const speculativePages = matchVmStat(vm.stdout, "Pages speculative");
    const freeBytes = (freePages + inactivePages + speculativePages) * pageSize;
    // GPU shares unified memory; we treat 60% of total as the "VRAM-equivalent
    // ceiling" to match lib/inference/local-suggestions.ts.
    const totalMb = Math.floor((totalBytes * 0.6) / (1024 * 1024));
    const freeMbRaw = Math.floor(freeBytes / (1024 * 1024));
    const freeMb = Math.min(freeMbRaw, totalMb);
    const usedMb = totalMb - freeMb;
    return { totalMb, usedMb, freeMb, source: "ps-rss" };
  } catch {
    return null;
  }
}

function matchVmStat(out: string, key: string): number {
  const re = new RegExp(`${key}:\\s*(\\d+)`);
  const m = re.exec(out);
  return m ? Number.parseInt(m[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// In-process ledger — state pinned to globalThis so Next.js HMR doesn't wipe
// it between route handler invocations.
// ---------------------------------------------------------------------------

interface LedgerState {
  currentSnapshot: LedgerSnapshot;
  pollTimer: NodeJS.Timeout | null;
  listeners: Set<ResourceEventListener>;
  reservationProvider: () => Reservation[];
  memoryOverride: (() => Promise<GpuMemory | null>) | null;
  reserveOverrideMb: number | null;
}

const LEDGER_KEY = "__controlDeckLedgerState";

function ledgerState(): LedgerState {
  const g = globalThis as unknown as Record<string, LedgerState | undefined>;
  if (!g[LEDGER_KEY]) {
    g[LEDGER_KEY] = {
      currentSnapshot: {
        at: 0,
        source: "unknown",
        totalMb: 0,
        usedMb: 0,
        freeMb: 0,
        reserveMb: DEFAULT_RESERVE_MB,
        processes: [],
        kvCaches: [],
        reservations: [],
      },
      pollTimer: null,
      listeners: new Set(),
      reservationProvider: () => [],
      memoryOverride: null,
      reserveOverrideMb: null,
    };
  }
  return g[LEDGER_KEY]!;
}

/** Called once by the arbiter when it boots so ledger snapshots can include reservations. */
export function setReservationProvider(fn: () => Reservation[]): void {
  ledgerState().reservationProvider = fn;
}

export function subscribe(listener: ResourceEventListener): () => void {
  const s = ledgerState();
  s.listeners.add(listener);
  // Replay the current snapshot to new subscribers so the UI paints immediately.
  listener({ kind: "ledger", at: Date.now(), snapshot: s.currentSnapshot });
  return () => s.listeners.delete(listener);
}

export function emit(event: ResourceEvent): void {
  for (const l of ledgerState().listeners) {
    try {
      l(event);
    } catch {
      /* listener errors don't break the bus */
    }
  }
}

export function getSnapshot(): LedgerSnapshot {
  return ledgerState().currentSnapshot;
}

export async function refreshSnapshot(): Promise<LedgerSnapshot> {
  const s = ledgerState();
  const memFn = s.memoryOverride ?? readGpuMemory;
  const [mem, procs, rawKvCaches] = await Promise.all([
    memFn(),
    s.memoryOverride ? Promise.resolve([]) : collectGpuProcesses(),
    s.memoryOverride ? Promise.resolve([]) : collectKvCaches(),
  ]);
  const gpuProcesses = procs ?? [];
  const kvCaches = attachProcessMemory(rawKvCaches, llamaCppProcessMemoryMb(gpuProcesses));
  const next = buildSnapshot(
    mem,
    gpuProcesses,
    s.reservationProvider(),
    s.reserveOverrideMb ?? DEFAULT_RESERVE_MB,
    kvCaches,
  );
  s.currentSnapshot = next;
  emit({ kind: "ledger", at: next.at, snapshot: next });
  return next;
}

function llamaCppProcessMemoryMb(procs: GpuProcess[]): number {
  return procs
    .filter((proc) => proc.providerHint === "llamacpp")
    .reduce((sum, proc) => sum + proc.usedMemoryMb, 0);
}

export function buildSnapshot(
  mem: GpuMemory | null,
  procs: GpuProcess[],
  reservations: Reservation[],
  reserveMb: number,
  kvCaches: KvCacheTelemetry[] = [],
): LedgerSnapshot {
  if (!mem) {
    return {
      at: Date.now(),
      source: "unknown",
      totalMb: 0,
      usedMb: 0,
      freeMb: 0,
      reserveMb,
      processes: procs,
      kvCaches,
      reservations,
    };
  }
  return {
    at: Date.now(),
    source: mem.source,
    totalMb: mem.totalMb,
    usedMb: mem.usedMb,
    freeMb: mem.freeMb,
    reserveMb,
    processes: procs,
    kvCaches,
    reservations,
  };
}

/**
 * Start the poll loop. Idempotent — calling twice is a no-op so a hot
 * reload doesn't spawn two pollers.
 */
export function startLedgerPolling(): void {
  const s = ledgerState();
  if (s.pollTimer) return;
  // Kick an immediate refresh so the first SSE subscriber doesn't see zeros.
  void refreshSnapshot();
  s.pollTimer = setInterval(() => {
    void refreshSnapshot();
  }, POLL_INTERVAL_MS);
  // Don't hold the event loop open just for polling.
  s.pollTimer.unref?.();
}

export function stopLedgerPolling(): void {
  const s = ledgerState();
  if (s.pollTimer) {
    clearInterval(s.pollTimer);
    s.pollTimer = null;
  }
}

export const __test = {
  setCurrentSnapshot(snap: LedgerSnapshot) {
    ledgerState().currentSnapshot = snap;
  },
  setMemoryOverride(fn: (() => Promise<GpuMemory | null>) | null) {
    ledgerState().memoryOverride = fn;
  },
  setReserveOverride(mb: number | null) {
    ledgerState().reserveOverrideMb = mb;
  },
  reset() {
    const s = ledgerState();
    s.currentSnapshot = {
      at: 0,
      source: "unknown",
      totalMb: 0,
      usedMb: 0,
      freeMb: 0,
      reserveMb: DEFAULT_RESERVE_MB,
      processes: [],
      kvCaches: [],
      reservations: [],
    };
    s.listeners.clear();
    s.reservationProvider = () => [];
    s.memoryOverride = null;
    s.reserveOverrideMb = null;
  },
};
