#!/usr/bin/env -S bun
/**
 * Smoke test for the persistent atspi-helper daemon.
 *
 * Exercises the full lifecycle so a regression in the daemon path is loud:
 *   1. cold spawn (no socket present)
 *   2. warm calls over the socket
 *   3. cross-process adoption (this same script re-invoked detects the running daemon)
 *   4. SIGKILL recovery
 *   5. one-shot fallback (CONTROL_DECK_NATIVE_NO_DAEMON=1 spawned subprocess)
 *
 * Run: `bun scripts/atspi-daemon-smoke.ts`
 * Linux + python3 + pyatspi required; fails fast otherwise.
 */
import { linuxAtspiAdapter, __resetDaemonCache } from "../lib/tools/native/linux-atspi";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as child_process from "node:child_process";

const PID_FILE = path.join(os.tmpdir(), `control-deck-atspi-${process.getuid?.() ?? 0}.pid`);
const SOCK = path.join(os.tmpdir(), `control-deck-atspi-${process.getuid?.() ?? 0}.sock`);

function readDaemonPid(): number | null {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, "utf8")).pid;
  } catch {
    return null;
  }
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return { value, ms };
}

async function main() {
  // Wipe to force a true cold path.
  for (const p of [SOCK, PID_FILE]) {
    try { fs.unlinkSync(p); } catch { /* not present */ }
  }
  __resetDaemonCache();

  console.log("[1] cold spawn");
  const cold = await timed("isAvailable", () => linuxAtspiAdapter.isAvailable!());
  if (!cold.value) throw new Error("isAvailable false on cold path");
  if (cold.ms > 500) console.warn(`  cold spawn took ${cold.ms.toFixed(0)}ms — slower than expected`);
  const pid1 = readDaemonPid();
  if (!pid1) throw new Error("no pid file after cold spawn");
  console.log(`  daemon pid=${pid1}`);

  console.log("[2] warm round-trips");
  for (let i = 0; i < 10; i++) {
    const r = await timed(`#${i + 1}`, () => linuxAtspiAdapter.isAvailable!());
    if (!r.value) throw new Error(`warm call #${i + 1} returned false`);
    if (r.ms > 50) console.warn(`  warm call slower than 50ms (${r.ms.toFixed(1)}ms)`);
  }

  console.log("[3] cross-process adoption (subprocess)");
  const adopt = child_process.execSync(
    `bun -e 'import { linuxAtspiAdapter } from "./lib/tools/native/linux-atspi"; const t=performance.now(); const ok=await linuxAtspiAdapter.isAvailable(); console.log(JSON.stringify({ok,ms:performance.now()-t}));'`,
    { cwd: path.resolve(__dirname, ".."), encoding: "utf8" },
  );
  console.log(`  ${adopt.trim()}`);
  const pid2 = readDaemonPid();
  if (pid2 !== pid1) throw new Error(`adoption failed: pid changed ${pid1} → ${pid2}`);

  console.log("[4] SIGKILL recovery");
  child_process.execSync(`kill -9 ${pid1}`);
  await new Promise((r) => setTimeout(r, 200));
  const recover = await timed("isAvailable after kill", () => linuxAtspiAdapter.isAvailable!());
  if (!recover.value) throw new Error("recovery failed");
  const pid3 = readDaemonPid();
  if (!pid3 || pid3 === pid1) throw new Error(`expected new daemon pid; got ${pid3}`);
  console.log(`  new daemon pid=${pid3}`);

  console.log("[5] one-shot fallback (CONTROL_DECK_NATIVE_NO_DAEMON=1)");
  const fallback = child_process.execSync(
    `bun -e 'import { linuxAtspiAdapter } from "./lib/tools/native/linux-atspi"; const t=performance.now(); const ok=await linuxAtspiAdapter.isAvailable(); console.log(JSON.stringify({ok,ms:performance.now()-t}));'`,
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, CONTROL_DECK_NATIVE_NO_DAEMON: "1" },
    },
  );
  const fb = JSON.parse(fallback.trim());
  console.log(`  one-shot ${JSON.stringify(fb)}`);
  if (!fb.ok) throw new Error("one-shot fallback failed");

  console.log("\nALL OK");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
