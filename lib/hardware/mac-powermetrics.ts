/**
 * Apple Silicon temperature + power collector via `powermetrics`.
 *
 * Powermetrics needs root. We never prompt; we rely on the user having
 * configured passwordless sudo for this one command (see the Settings UI
 * for instructions). The `canUsePowermetrics()` probe checks with
 * `sudo -n true` first — non-interactive, returns non-zero instantly if
 * sudo would prompt, so we never block.
 *
 * Users who want this feature add this to /etc/sudoers.d/control-deck
 * via `sudo visudo -f /etc/sudoers.d/control-deck`:
 *
 *   <username> ALL=(root) NOPASSWD: /usr/bin/powermetrics
 *
 * …then flip the toggle in Settings > Hardware > Powermetrics.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface PowermetricsSnapshot {
  /** GPU die temperature, °C. Undefined when SMC key is missing. */
  gpuTempC?: number;
  /** CPU die temperature, °C. */
  cpuTempC?: number;
  /** Instantaneous GPU power, milliwatts. */
  gpuPowerMw?: number;
  /** CPU package power, milliwatts. */
  cpuPowerMw?: number;
}

/**
 * Probe whether `sudo powermetrics` can run non-interactively. Returns
 * `true` only when both `sudo -n true` succeeds AND `powermetrics` is
 * reachable on PATH. False otherwise — the caller treats it as "disabled".
 */
export async function canUsePowermetrics(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await execAsync("sudo -n true", { timeout: 1500 });
  } catch {
    return false;
  }
  try {
    await execAsync("which powermetrics", { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Single-shot powermetrics sample. Expensive enough (~500ms) that callers
 * should cache it for a few seconds if polled frequently.
 */
export async function collectPowermetrics(): Promise<PowermetricsSnapshot | null> {
  if (process.platform !== "darwin") return null;
  try {
    // -i 500 = sample window in ms, -n 1 = one sample only.
    // --samplers smc gives temps; gpu_power gives GPU wattage.
    // Wait timeout: 3s gives headroom over the ~1s sample window.
    const { stdout } = await execAsync(
      "sudo -n powermetrics --samplers smc,gpu_power -i 500 -n 1 2>/dev/null",
      { timeout: 3000, maxBuffer: 1024 * 1024 },
    );
    return parsePowermetrics(stdout);
  } catch {
    return null;
  }
}

/** Exposed for tests. */
export function parsePowermetrics(stdout: string): PowermetricsSnapshot {
  const snap: PowermetricsSnapshot = {};

  // Apple Silicon powermetrics emits lines like:
  //   GPU die temperature: 52.02 C (avg)
  //   CPU die temperature: 48.12 C (avg)
  //   GPU Power: 1234 mW
  //   CPU Power: 5678 mW
  //   Package Power: 6912 mW
  // The capitalisation varies across macOS versions; regex is case-insensitive.
  const gpuTemp = stdout.match(/GPU die temperature:\s*([\d.]+)\s*C/i);
  if (gpuTemp) snap.gpuTempC = Math.round(Number.parseFloat(gpuTemp[1]) * 10) / 10;

  const cpuTemp = stdout.match(/CPU die temperature:\s*([\d.]+)\s*C/i);
  if (cpuTemp) snap.cpuTempC = Math.round(Number.parseFloat(cpuTemp[1]) * 10) / 10;

  const gpuPower = stdout.match(/GPU Power:\s*(\d+)\s*mW/i);
  if (gpuPower) snap.gpuPowerMw = Number.parseInt(gpuPower[1], 10);

  const cpuPower = stdout.match(/CPU Power:\s*(\d+)\s*mW/i);
  if (cpuPower) snap.cpuPowerMw = Number.parseInt(cpuPower[1], 10);

  return snap;
}
