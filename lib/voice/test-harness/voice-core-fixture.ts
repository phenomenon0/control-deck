/**
 * voice-core sidecar fixture for integration tests.
 *
 *   await withVoiceCore(async (url) => {
 *     // url is e.g. "ws://127.0.0.1:4245" — pass to StreamingSttClient
 *   });
 *
 * If `VOICE_CORE_URL` is set, we trust the caller has already booted the
 * sidecar (CI override, or the user is running `npm run voice:core` in
 * another terminal). Otherwise we spawn `npm run voice:core`, wait on
 * `/health`, and tear it down on exit.
 */

import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_URL = "ws://127.0.0.1:4245";
const HEALTH_URL = "http://127.0.0.1:4245/health";

const ENV_FLAG = "VOICE_CORE_URL";

export interface VoiceCoreHandle {
  url: string;
  /** undefined when we're trusting an externally-booted sidecar. */
  process?: ChildProcess;
}

/** Boot voice-core if not already running, run `fn`, then tear it down. */
export async function withVoiceCore<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const handle = await ensureVoiceCore();
  try {
    return await fn(handle.url);
  } finally {
    if (handle.process) await stopVoiceCore(handle);
  }
}

export async function ensureVoiceCore(timeoutMs = 30_000): Promise<VoiceCoreHandle> {
  const externalUrl = process.env[ENV_FLAG];
  if (externalUrl) {
    if (!(await healthOk(externalUrl.replace(/^ws/, "http") + "/health"))) {
      throw new Error(`${ENV_FLAG}=${externalUrl} but /health is not responding`);
    }
    return { url: externalUrl };
  }

  if (await healthOk(HEALTH_URL)) {
    return { url: DEFAULT_URL };
  }

  const child = spawn("npm", ["run", "voice:core"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  child.stderr?.on("data", (chunk) => {
    if (process.env.VOICE_CORE_DEBUG) process.stderr.write(`[voice-core] ${chunk}`);
  });
  child.stdout?.on("data", (chunk) => {
    if (process.env.VOICE_CORE_DEBUG) process.stdout.write(`[voice-core] ${chunk}`);
  });

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode != null) {
      throw new Error(`voice-core exited with code ${child.exitCode} before becoming healthy`);
    }
    if (await healthOk(HEALTH_URL)) {
      return { url: DEFAULT_URL, process: child };
    }
    await sleep(500);
  }
  child.kill("SIGTERM");
  throw new Error(`voice-core did not become healthy within ${timeoutMs}ms (start \`npm run voice:core\` manually or set ${ENV_FLAG})`);
}

export async function stopVoiceCore(handle: VoiceCoreHandle): Promise<void> {
  if (!handle.process || handle.process.exitCode != null) return;
  handle.process.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (!handle.process || handle.process.exitCode != null) return resolve();
    const t = setTimeout(() => {
      handle.process?.kill("SIGKILL");
      resolve();
    }, 5000);
    handle.process.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function healthOk(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    return resp.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
