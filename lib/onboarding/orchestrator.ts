// Onboarding orchestrator — one-click install. Detects hardware → audits state →
// streams idempotent Steps. Targets ~5min wall-clock; LLM pull dominates.
// Transport-agnostic: SSE route relays events, tests drive runOnboarding() directly.

import { spawn } from "node:child_process";
import { constants as fsConstants, existsSync } from "node:fs";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { detectSystem } from "@/lib/system/detect";
import {
  HARDWARE_TIERS,
  getTier,
  recommendTier,
  tierDiskMb,
  type TierBundle,
  type TierId,
} from "@/lib/inference/hardware-tiers";
import { loadRecipe, type CommandSpec, type ConsentSpec, type Recipe } from "./recipe";

/** Platform-correct state dir — LOCALAPPDATA on Windows, ~/Library on macOS, XDG on Linux. */
function defaultStateDir(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "ControlDeck", "state");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "ControlDeck", "state");
  }
  const xdg = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(xdg, "control-deck");
}
const STATE_DIR = defaultStateDir();
const DONE_FLAG = join(STATE_DIR, "onboarding.done");

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const VOICE_CORE_URL = process.env.VOICE_CORE_URL ?? "http://127.0.0.1:4245";

export type StepStatus = "running" | "done" | "skipped" | "failed";

export interface Step {
  id: string;
  title: string;
  status: StepStatus;
  detail?: string;
  /** 0..1 for live progress bars (model pulls). */
  progress?: number;
  /** ms since orchestrator start, set by the runner. */
  t?: number;
}

export interface ProbeResult {
  hardware: {
    backend: string;
    gpu: { name: string; vramMb: number } | null;
    ramGb: number;
  };
  tier: TierId;
  tierLabel: string;
  diskMb: number;
  llm: { id: string; sizeMb: number; runner: string };
  stt: { id: string; sizeMb: number };
  tts: { id: string; sizeMb: number };
  /** What's missing on this machine right now. */
  missing: {
    ollama: boolean;
    ollamaService: boolean;
    llmModel: boolean;
    voiceCore: boolean;
    sttEngine: boolean;
    ttsEngine: boolean;
  };
  /** Surface the install consent copy + command preview so the UI can ask permission. */
  installPlan: {
    platform: string;
    consent: ConsentSpec;
    /**
     * False when the machine is missing the prerequisite installer (e.g.
     * Homebrew on a vanilla Mac). UI renders the manual-download branch and
     * suppresses the consent checkbox in this case.
     */
    autoInstallable?: boolean;
  } | null;
  /** Version reported by /api/version when ollama is running, else null. */
  ollamaVersion: string | null;
  done: boolean;
}

export interface Consents {
  /** User checked the box to let us install Ollama via the platform recipe. */
  installOllama?: boolean;
}

// ---------------------------------------------------------------------------
// Probe — read-only audit. Cheap; safe to call repeatedly from the UI.

/** Resolve the recipe + capture the error for the UI, without re-throwing. */
function tryLoadRecipe(): { recipe: Recipe | null; error: string | null } {
  try {
    return { recipe: loadRecipe(), error: null };
  } catch (err) {
    return { recipe: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function probeOnboarding(): Promise<ProbeResult> {
  return probeOnboardingWith(tryLoadRecipe());
}

async function probeOnboardingWith(
  loaded: { recipe: Recipe | null; error: string | null },
): Promise<ProbeResult> {
  const sys = detectSystem();
  const rec = recommendTier({
    backend: sys.backend,
    gpu: sys.gpu,
    ramGb: sys.ram,
  });
  const tier = getTier(rec.best);

  const { recipe, error: recipeError } = loaded;

  const [ollamaPresent, ollamaService, llmModel, voiceCoreHealth, ollamaVersion] = await Promise.all([
    binaryOnPath("ollama"),
    probeOllamaService(),
    probeLlmModel(tier.cascade.llm.id),
    probeVoiceCore(),
    probeOllamaVersion(),
  ]);

  const sttPresent = engineLoadedOrAvailable(voiceCoreHealth, tier.cascade.stt.id);
  const ttsPresent = engineLoadedOrAvailable(voiceCoreHealth, tier.cascade.tts.id);

  // Decide whether the *machine* can actually run the install command — a
  // vanilla Mac without Homebrew, or a Linux box without pkexec, can't honor
  // a consent click. Surface that up front so the UI can show a "download
  // manually" card instead of a checkbox we won't honor.
  const installerMissing =
    !ollamaPresent && recipe ? await firstMissingDependency(recipe) : null;

  return {
    hardware: {
      backend: sys.backend,
      gpu: sys.gpu ? { name: sys.gpu.name, vramMb: sys.gpu.vram } : null,
      ramGb: sys.ram,
    },
    tier: tier.id,
    tierLabel: tier.label,
    diskMb: tierDiskMb(tier),
    llm: {
      id: tier.cascade.llm.id,
      sizeMb: tier.cascade.llm.sizeMb ?? 0,
      runner: tier.cascade.llm.runner,
    },
    stt: { id: tier.cascade.stt.id, sizeMb: tier.cascade.stt.sizeMb ?? 0 },
    tts: { id: tier.cascade.tts.id, sizeMb: tier.cascade.tts.sizeMb ?? 0 },
    missing: {
      ollama: !ollamaPresent,
      ollamaService: !ollamaService,
      llmModel: !llmModel,
      voiceCore: !voiceCoreHealth.ok,
      sttEngine: !sttPresent,
      ttsEngine: !ttsPresent,
    },
    ollamaVersion,
    // Only surface installPlan when we'd actually use it — the consent panel
    // is rendered on `missing.ollama`, and nothing else reads this field.
    installPlan: !ollamaPresent
      ? recipe
        ? installerMissing
          ? {
              // Tell the UI to show the "download manually" branch instead of
              // a checkbox we can't honor (e.g. vanilla Mac w/o Homebrew).
              platform: recipe.platform,
              consent: {
                title: "Auto-install unavailable",
                summary: `\`${installerMissing}\` isn't installed, so we can't run the official installer for you. Download Ollama directly and we'll continue from there.`,
                command_preview: "",
                manual_fallback: recipe.ollama.install.consent.manual_fallback,
              },
              autoInstallable: false,
            }
          : { platform: recipe.platform, consent: recipe.ollama.install.consent, autoInstallable: true }
        : recipeError
          ? {
              platform: process.platform,
              consent: {
                title: "Auto-install unavailable",
                summary: recipeError,
                command_preview: "",
                manual_fallback: "See https://ollama.com/download",
              },
              autoInstallable: false,
            }
          : null
      : null,
    done: await isDone(),
  };
}

// ---------------------------------------------------------------------------
// Run — the actual one-click. Yields Step events.

export async function* runOnboarding(
  opts: { tierOverride?: TierId; consents?: Consents } = {},
): AsyncGenerator<Step, void, undefined> {
  const t0 = Date.now();
  const stamp = <S extends Step>(s: S): S => ({ ...s, t: Date.now() - t0 });
  const consents = opts.consents ?? {};

  // Load the recipe once and reuse it for both the probe and the run, so we
  // don't pay the filesystem cost twice and can't observe a TOCTOU swap.
  const loaded = tryLoadRecipe();
  const recipe = loaded.recipe;
  const probe = await probeOnboardingWith(loaded);
  const tier = opts.tierOverride ? getTier(opts.tierOverride) : getTier(probe.tier);

  yield stamp({
    id: "detect",
    title: `Detected ${probe.hardware.backend.toUpperCase()} · ${tier.label}`,
    status: "done",
    detail: probe.hardware.gpu
      ? `${probe.hardware.gpu.name} · ${(probe.hardware.gpu.vramMb / 1024).toFixed(1)} GB VRAM · ${probe.hardware.ramGb} GB RAM`
      : `${probe.hardware.ramGb} GB RAM`,
  });

  // --- Hardware floor ---------------------------------------------------
  // Fail fast on machines that can't physically run the recommended tier,
  // so the user doesn't sit through a 5 GB pull only to OOM at smoke time.
  const floor = checkHardwareFloor(probe, tier);
  if (!floor.ok) {
    yield stamp({
      id: "floor-check",
      title: "Hardware check",
      status: "failed",
      detail: floor.detail,
    });
    return;
  }
  if (floor.warn) {
    yield stamp({
      id: "floor-check",
      title: "Hardware check",
      status: "done",
      detail: floor.warn,
    });
  }

  // --- Ollama install ----------------------------------------------------
  if (probe.missing.ollama) {
    if (!recipe) {
      yield stamp({
        id: "install-ollama",
        title: "Install Ollama",
        status: "failed",
        detail: "No install recipe for this platform. See https://ollama.com/download.",
      });
      return;
    }

    if (consents.installOllama !== true) {
      yield stamp({
        id: "install-ollama",
        title: "Install Ollama",
        status: "failed",
        detail: `Need permission to install Ollama. Tick the consent box and retry, or run manually: \`${recipe.ollama.install.consent.manual_fallback}\``,
      });
      return;
    }

    // pkexec only works under a graphical session (X11 or Wayland). Detect
    // headless runs (SSH, bare TTY, container without X) so the user sees a
    // useful error rather than a silent non-zero exit.
    if (recipe.platform === "linux" && requiresGraphicalAgent(recipe.ollama.install.command)) {
      if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        yield stamp({
          id: "install-ollama",
          title: "Install Ollama",
          status: "failed",
          detail: `No graphical session detected — \`${recipe.ollama.install.command.bin}\` needs a polkit agent. Open a terminal and run: \`${recipe.ollama.install.consent.manual_fallback}\``,
        });
        return;
      }
    }

    // Ollama's install.sh is glibc-targeted and assumes a writable /usr/local.
    // NixOS (immutable FHS) and Alpine (musl libc) both break it silently.
    // Detect those and emit a clear "not supported here" message instead of
    // letting the script fail with a binary that doesn't run.
    const unsupported = detectUnsupportedDistro();
    if (unsupported) {
      yield stamp({
        id: "install-ollama",
        title: "Install Ollama",
        status: "failed",
        detail: `${unsupported} isn't supported by Ollama's install script. Install via your distro's package manager and retry. See https://ollama.com/download for native packages.`,
      });
      return;
    }

    // Pre-flight: the install command and its pipeline dependencies must
    // exist on PATH. Without this, missing `pkexec` / `curl` / `brew` /
    // `winget` produces a generic ENOENT exit-127 error with no fix.
    const missingBin = await firstMissingDependency(recipe);
    if (missingBin) {
      yield stamp({
        id: "install-ollama",
        title: "Install Ollama",
        status: "failed",
        detail: `\`${missingBin}\` is not installed on this system. Install it via your package manager and retry — or run manually: \`${recipe.ollama.install.consent.manual_fallback}\``,
      });
      return;
    }

    yield stamp({
      id: "install-ollama",
      title: "Install Ollama",
      status: "running",
      detail: `Running ${recipe.ollama.install.consent.command_preview}`,
    });
    let lastInstallEmit = 0;
    let lastLine: string | undefined;
    for await (const line of streamChild(recipe.ollama.install.command)) {
      lastLine = line.text;
      const now = Date.now();
      if (line.kind === "exit") {
        if (line.code !== (recipe.ollama.install.command.expect_exit ?? 0)) {
          // pkexec returns 126 when the user dismisses the polkit prompt.
          // brew/winget don't reuse that code for normal failures, so it's
          // safe to special-case as "user cancelled" everywhere.
          const userCancelled = line.code === 126;
          yield stamp({
            id: "install-ollama",
            title: "Install Ollama",
            status: "failed",
            detail: userCancelled
              ? "Installation cancelled — click Retry when you're ready, or untick the consent box to install manually."
              : `${recipe.ollama.install.command.bin} exited ${line.code ?? "?"}${lastLine ? ` — ${trimLine(lastLine)}` : ""}`,
          });
          return;
        }
      } else if (now - lastInstallEmit >= 300) {
        lastInstallEmit = now;
        yield stamp({
          id: "install-ollama",
          title: "Install Ollama",
          status: "running",
          detail: trimLine(line.text),
        });
      }
    }
    // On Windows the installer writes PATH into the registry, but the running
    // Electron process holds a stale snapshot — refresh it before verify or
    // the new `ollama.exe` won't be visible to subsequent spawns.
    await refreshWindowsPath();
    // Re-probe that ollama is actually on PATH now.
    const verifyCode = await runOnce(
      recipe.ollama.install.verify.bin,
      recipe.ollama.install.verify.args,
      5000,
    );
    if (verifyCode !== (recipe.ollama.install.verify.expect_exit ?? 0)) {
      yield stamp({
        id: "install-ollama",
        title: "Install Ollama",
        status: "failed",
        detail: "Install finished but `ollama` is still not on PATH. Open a new terminal and retry.",
      });
      return;
    }
    yield stamp({
      id: "install-ollama",
      title: "Install Ollama",
      status: "done",
      detail: "installed",
    });
  }

  // --- Ollama service ----------------------------------------------------
  if (probe.missing.ollamaService) {
    yield stamp({ id: "start-ollama", title: "Start Ollama service", status: "running" });
    const started = await startOllamaService(recipe);
    yield stamp({
      id: "start-ollama",
      title: "Start Ollama service",
      status: started.ok ? "done" : "failed",
      detail: started.detail,
    });
    if (!started.ok) return;
  } else {
    yield stamp({
      id: "start-ollama",
      title: "Ollama service",
      status: "skipped",
      detail: "already running",
    });
  }

  // --- LLM pull ----------------------------------------------------------
  if (probe.missing.llmModel) {
    const totalMb = tier.cascade.llm.sizeMb ?? 0;
    const throttleMs = recipe?.ollama.pull.throttle_ms ?? 500;
    yield stamp({
      id: "pull-llm",
      title: `Pull ${tier.cascade.llm.label}`,
      status: "running",
      detail: `${(totalMb / 1024).toFixed(1)} GB — this is the slow step`,
      progress: 0,
    });
    let lastEmitted = 0;
    let sawSuccess = false;
    for await (const evt of pullOllamaModel(tier.cascade.llm.id)) {
      // Throttle progress emits — Ollama streams hundreds of progress lines.
      const now = Date.now();
      if (evt.status === "running" && now - lastEmitted < throttleMs) continue;
      lastEmitted = now;
      yield stamp({
        id: "pull-llm",
        title: `Pull ${tier.cascade.llm.label}`,
        status: evt.status,
        detail: evt.detail,
        progress: evt.progress,
      });
      if (evt.status === "failed") return;
      if (evt.status === "done") sawSuccess = true;
    }
    // The pull stream can close cleanly without emitting `status:success`
    // (e.g. TCP drop on a flaky connection). Don't trust the stream alone —
    // re-probe /api/tags before claiming the model is present.
    if (!sawSuccess) {
      const verified = await probeLlmModel(tier.cascade.llm.id);
      if (!verified) {
        yield stamp({
          id: "pull-llm",
          title: `Pull ${tier.cascade.llm.label}`,
          status: "failed",
          detail:
            "Pull stream ended before the model arrived — likely a network drop. Click Retry; ollama keeps the partial cache so it'll resume.",
        });
        return;
      }
    }
  } else {
    yield stamp({
      id: "pull-llm",
      title: `Pull ${tier.cascade.llm.label}`,
      status: "skipped",
      detail: "already installed",
    });
  }

  // --- Voice-core ---------------------------------------------------------
  if (probe.missing.voiceCore) {
    // Try to install + spawn voice-core ourselves before giving up. This
    // path covers `next start` deployments where the Electron supervisor
    // isn't running. The supervisor (when present) will pick up the spawn
    // on next launch via the persisted tier file.
    yield stamp({ id: "voice-core", title: "Voice sidecar", status: "running" });
    for await (const evt of provisionVoiceCore(tier.id)) {
      yield stamp({ id: "voice-core", title: "Voice sidecar", ...evt });
      if (evt.status === "failed") return;
    }
  } else {
    yield stamp({
      id: "voice-core",
      title: "Voice sidecar",
      status: "skipped",
      detail: "reachable",
    });
  }

  // STT / TTS engines — voice-core ships them; status comes straight from /health.
  yield stamp({
    id: "stt",
    title: `STT · ${tier.cascade.stt.label}`,
    status: probe.missing.sttEngine ? "failed" : "skipped",
    detail: probe.missing.sttEngine
      ? "engine not available — check apps/voice-core/models/"
      : "ready",
  });
  yield stamp({
    id: "tts",
    title: `TTS · ${tier.cascade.tts.label}`,
    status: probe.missing.ttsEngine ? "failed" : "skipped",
    detail: probe.missing.ttsEngine
      ? "engine not available — check apps/voice-core/models/"
      : "ready",
  });

  // --- Smoke test ---------------------------------------------------------
  yield stamp({ id: "smoke", title: "Smoke-test the LLM", status: "running" });
  // First inference cold-loads the model from disk into RAM, which dominates
  // wall time on CPU-only boxes (90 s+ for a 4 GB GGUF). Bump the timeout
  // accordingly so the smoke step doesn't false-fail on slow hardware.
  const smokeCfg = recipe?.smoke ? { ...recipe.smoke } : undefined;
  if (smokeCfg && probe.hardware.backend === "cpu") {
    smokeCfg.timeout_ms = Math.max(smokeCfg.timeout_ms, 180_000);
  }
  const smoke = await smokeTestLlm(tier.cascade.llm.id, smokeCfg);
  yield stamp({
    id: "smoke",
    title: "Smoke-test the LLM",
    status: smoke.ok ? "done" : "failed",
    detail: smoke.detail,
  });
  if (!smoke.ok) return;

  // Only mark "done" if the whole stack is healthy. If voice engines are
  // missing the user can still chat, but we don't want the gate to silently
  // accept a partially-broken state — re-run prompts them to fix voice.
  const voiceReady = !probe.missing.sttEngine && !probe.missing.ttsEngine;
  if (voiceReady) {
    await markDone(tier.id);
  }
  const wallSec = ((Date.now() - t0) / 1000).toFixed(1);
  yield stamp({
    id: "ready",
    title: voiceReady ? `Ready in ${wallSec} s` : `Chat-ready in ${wallSec} s (voice incomplete)`,
    status: "done",
    detail: voiceReady
      ? "Open Chat to start talking."
      : "Chat works. Voice engines are missing — see apps/voice-core/models/ to add them, or click Skip to dismiss this screen.",
  });
}

// ---------------------------------------------------------------------------
// State flag

export async function isDone(): Promise<boolean> {
  return existsSync(DONE_FLAG);
}

export async function readDoneState(): Promise<{
  done: boolean;
  tier?: TierId;
  completedAt?: string;
  /** Live probe so the gate can detect "done but broken" (service died, port hijacked). */
  ollamaHealthy?: boolean;
}> {
  if (!existsSync(DONE_FLAG)) return { done: false };
  let stored: { tier?: TierId; completedAt?: string } = {};
  try {
    const raw = await readFile(DONE_FLAG, "utf8");
    stored = JSON.parse(raw);
  } catch {
    /* leave stored empty; we still know it's done */
  }
  const ollamaHealthy = await probeOllamaService();
  return { done: true, ...stored, ollamaHealthy };
}

async function markDone(tier: TierId): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    DONE_FLAG,
    JSON.stringify({ tier, completedAt: new Date().toISOString() }, null, 2),
  );
}

/** Used by the Skip button — marks done without a tier or smoke run. */
export async function markDoneManual(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    DONE_FLAG,
    JSON.stringify({ skipped: true, completedAt: new Date().toISOString() }, null, 2),
  );
}

export async function clearDone(): Promise<void> {
  try {
    const { rm } = await import("node:fs/promises");
    await rm(DONE_FLAG, { force: true });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Internals

// Needs a graphical polkit agent (i.e. pkexec). sudo & direct calls don't.
function requiresGraphicalAgent(cmd: CommandSpec): boolean {
  return cmd.bin === "pkexec";
}

// Pre-flight: enough RAM and disk for the chosen tier? Aborts before the multi-GB pull.
// Floors: 6 GB RAM (smaller thrashes & OOMs at smoke), tier-size + 2 GB free disk.
export function checkHardwareFloor(
  probe: ProbeResult,
  tier: TierBundle,
): { ok: true; warn?: string } | { ok: false; detail: string } {
  if (probe.hardware.ramGb > 0 && probe.hardware.ramGb < 6) {
    return {
      ok: false,
      detail: `Only ${probe.hardware.ramGb} GB RAM detected. Local LLMs need at least 6 GB to run usefully; the smoke test will OOM. Use cloud models instead or add memory.`,
    };
  }
  const sys = detectSystem();
  const requiredGb = Math.ceil(tierDiskMb(tier) / 1024) + 2;
  const freeGb = sys.storage?.freeGb ?? Number.POSITIVE_INFINITY;
  if (freeGb < requiredGb) {
    return {
      ok: false,
      detail: `Need ~${requiredGb} GB free on the home volume but only ${freeGb} GB available. Free up space or pick a smaller tier and retry.`,
    };
  }
  if (probe.hardware.ramGb > 0 && probe.hardware.ramGb < 8) {
    return {
      ok: true,
      warn: `${probe.hardware.ramGb} GB RAM is tight — expect 5–15 tok/s and slow context recall. Close other apps for best results.`,
    };
  }
  return { ok: true };
}

// Linux distros known-incompatible with Ollama's install.sh (immutable FS / musl).
function detectUnsupportedDistro(): string | null {
  if (process.platform !== "linux") return null;
  if (existsSync("/etc/nixos") || existsSync("/etc/NIXOS")) return "NixOS";
  if (existsSync("/etc/alpine-release")) return "Alpine Linux";
  return null;
}

// Re-read PATH from the Windows registry — installers update HKCU but our
// launch-time PATH stays stale, making post-install verify spuriously fail.
async function refreshWindowsPath(): Promise<void> {
  if (process.platform !== "win32") return;
  await new Promise<void>((resolve) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')",
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    let buf = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buf += chunk;
    });
    const finish = (): void => {
      const merged = buf.trim();
      if (merged) process.env.PATH = merged;
      resolve();
    };
    child.on("exit", finish);
    child.on("error", () => resolve());
  });
}

// First missing install dependency, or null if all present. Extracts pipeline
// tools from shell-piped args (e.g. `sh -c 'curl … | sh'`).
async function firstMissingDependency(recipe: Recipe): Promise<string | null> {
  const cmd = recipe.ollama.install.command;
  const required = new Set<string>([cmd.bin]);
  for (const a of cmd.args) {
    for (const candidate of ["curl", "wget", "winget", "powershell"]) {
      if (a.includes(candidate + " ")) required.add(candidate);
    }
  }
  required.add(recipe.ollama.install.verify.bin);
  for (const bin of required) {
    if (!(await binaryOnPath(bin))) return bin;
  }
  return null;
}

/**
 * Build env.PATH augmented with the standard install prefixes. Electron on
 * macOS inherits launchd's PATH (no `/opt/homebrew/bin`); GUI sessions on
 * Linux sometimes omit `/usr/local/bin`. Apply this to every spawn so a
 * freshly-installed binary is actually visible to the orchestrator.
 */
function augmentedEnv(): NodeJS.ProcessEnv {
  // Test seam: when set, skip augmentation so tests can simulate "binary
  // missing" by overriding PATH without /usr/local/bin shadowing the result.
  if (process.env.CONTROL_DECK_DISABLE_PATH_AUGMENT === "1") {
    return { ...process.env };
  }
  const extras: string[] = [];
  if (process.platform === "darwin") {
    extras.push("/opt/homebrew/bin", "/usr/local/bin");
  } else if (process.platform === "linux") {
    extras.push("/usr/local/bin");
  }
  const sep = process.platform === "win32" ? ";" : ":";
  const existing = (process.env.PATH ?? "").split(sep).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const dir of [...extras, ...existing]) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    merged.push(dir);
  }
  return { ...process.env, PATH: merged.join(sep) };
}

/**
 * Portable PATH lookup — never depends on `which` (POSIX) or `where` (Windows)
 * being installed. Walks `env.PATH` directly and checks for executability.
 * Honours `PATHEXT` on Windows so `ollama` resolves `ollama.exe`.
 */
async function binaryOnPath(bin: string): Promise<boolean> {
  const sep = process.platform === "win32" ? ";" : ":";
  const env = augmentedEnv();
  const dirs = (env.PATH ?? "").split(sep).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        await access(join(dir, bin + ext), fsConstants.X_OK);
        return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}

async function probeOllamaService(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Returns the running ollama's version string, or null if unreachable. */
async function probeOllamaVersion(): Promise<string | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

async function probeLlmModel(modelId: string): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return false;
    const data = (await r.json()) as { models?: Array<{ name?: string; model?: string }> };
    const wanted = modelId.toLowerCase();
    return Boolean(
      data.models?.some(
        (m) =>
          (m.name ?? "").toLowerCase() === wanted ||
          (m.model ?? "").toLowerCase() === wanted ||
          (m.name ?? "").toLowerCase().startsWith(wanted + ":"),
      ),
    );
  } catch {
    return false;
  }
}

async function probeVoiceCore(): Promise<{ ok: boolean; engines: Record<string, EngineSlot> }> {
  try {
    const r = await fetch(`${VOICE_CORE_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return { ok: false, engines: {} };
    const data = (await r.json()) as {
      ok?: boolean;
      engines?: Record<string, EngineSlot>;
    };
    return { ok: Boolean(data.ok), engines: data.engines ?? {} };
  } catch {
    return { ok: false, engines: {} };
  }
}

interface EngineSlot {
  id: string;
  available?: boolean;
  loaded?: boolean;
}

function engineLoadedOrAvailable(
  health: { engines: Record<string, EngineSlot> },
  id: string,
): boolean {
  const slot = health.engines[id];
  if (!slot) return false;
  return Boolean(slot.available || slot.loaded);
}

async function startOllamaService(recipe: Recipe | null): Promise<{ ok: boolean; detail: string }> {
  const attempts: CommandSpec[] = recipe?.ollama.service.start_attempts ?? [
    { bin: "systemctl", args: ["--user", "start", "ollama"] },
    { bin: "systemctl", args: ["start", "ollama"] },
  ];
  for (const a of attempts) {
    const code = await runOnce(a.bin, a.args, 5000);
    if (code === 0) {
      // Poll up to 10 s for the API to answer.
      for (let i = 0; i < 20; i++) {
        if (await probeOllamaService()) {
          await enableServiceAutostart(recipe);
          return { ok: true, detail: `via ${a.bin} ${a.args.join(" ")}` };
        }
        await sleep(500);
      }
    }
  }

  // Detached `ollama serve` fallback — won't survive reboot, but unblocks today.
  const fallback: CommandSpec = recipe?.ollama.service.fallback ?? {
    bin: "ollama",
    args: ["serve"],
    detach: true,
  };
  try {
    const child = spawn(fallback.bin, fallback.args, {
      detached: fallback.detach ?? true,
      stdio: "ignore",
      env: augmentedEnv(),
      windowsHide: true, // suppress stray cmd console on Windows
    });
    child.unref();
    for (let i = 0; i < 30; i++) {
      if (await probeOllamaService()) {
        return {
          ok: true,
          detail: `spawned \`${fallback.bin} ${fallback.args.join(" ")}\` (detached) — won't survive reboot; install a systemd unit to make it permanent`,
        };
      }
      await sleep(500);
    }
  } catch {
    /* fall through */
  }
  return {
    ok: false,
    detail: "Could not start Ollama. Run `ollama serve` in a terminal, then retry.",
  };
}

// Best-effort autostart enable. All failures swallowed — missing unit /
// non-systemd / sandboxed --user are all expected non-paths.
async function enableServiceAutostart(recipe: Recipe | null): Promise<void> {
  const enables = recipe?.ollama.service.enable_attempts;
  if (!enables || enables.length === 0) return;
  for (const cmd of enables) {
    try {
      await runOnce(cmd.bin, cmd.args, 5000);
    } catch {
      /* non-fatal — keep going */
    }
  }
}

interface OllamaProgressEvent {
  status: StepStatus;
  detail?: string;
  progress?: number;
}

/**
 * Install voice-core deps via `uv sync` and spawn the sidecar detached, in
 * dev / `next start` environments where the Electron supervisor isn't
 * running. Yields one event per phase so the UI shows real progress instead
 * of staring at "running" for two minutes.
 *
 * Skips installing deps when the venv is already populated. Skips spawn when
 * /health responds (somebody else already started it).
 */
async function* provisionVoiceCore(
  tierId: TierId,
): AsyncGenerator<OllamaProgressEvent, void, undefined> {
  // Re-probe first — maybe the supervisor just spawned it.
  if ((await probeVoiceCore()).ok) {
    yield { status: "done", detail: "already running" };
    return;
  }
  const voiceCoreDir = join(process.cwd(), "apps", "voice-core");
  if (!existsSync(join(voiceCoreDir, "pyproject.toml"))) {
    yield {
      status: "failed",
      detail: `apps/voice-core/ not found under ${process.cwd()}. Run from a Control Deck checkout, or restart the Electron app.`,
    };
    return;
  }
  if (!(await binaryOnPath("uv"))) {
    yield {
      status: "failed",
      detail: "`uv` is required to install the voice sidecar. Install it from https://astral.sh/uv, then click Retry.",
    };
    return;
  }
  // 1. uv sync — only emits a step update if it has to do real work.
  const venvBin = join(voiceCoreDir, ".venv", "bin", "python");
  const venvExe = join(voiceCoreDir, ".venv", "Scripts", "python.exe");
  const venvReady = existsSync(venvBin) || existsSync(venvExe);
  if (!venvReady) {
    yield { status: "running", detail: "installing voice deps (uv sync)…" };
    const code = await runOnce("uv", ["sync", "--directory", voiceCoreDir], 600_000);
    if (code !== 0) {
      yield {
        status: "failed",
        detail: `uv sync failed (exit ${code ?? "?"}). Run \`uv sync --directory apps/voice-core\` manually for full output.`,
      };
      return;
    }
  }
  // 2. Spawn detached. Don't unref before the process actually starts —
  // Bun spawn returns immediately, so the unref + poll cycle is safe.
  yield { status: "running", detail: "starting voice sidecar…" };
  try {
    const host = process.env.VOICE_CORE_HOST ?? "127.0.0.1";
    const port = process.env.VOICE_CORE_PORT ?? "4245";
    const child = spawn(
      "uv",
      ["run", "--directory", voiceCoreDir, "voice-core", "serve", "--host", host, "--port", port, "--tier", tierId],
      { detached: true, stdio: "ignore", env: augmentedEnv(), windowsHide: true },
    );
    child.unref();
  } catch (err) {
    yield { status: "failed", detail: `Failed to spawn voice-core: ${(err as Error).message}` };
    return;
  }
  // 3. Poll /health up to 30 s — first start cold-loads the engine.
  for (let i = 0; i < 60; i++) {
    if ((await probeVoiceCore()).ok) {
      yield { status: "done", detail: "started" };
      return;
    }
    await sleep(500);
  }
  yield {
    status: "failed",
    detail: "voice-core didn't respond on /health within 30 s. Check apps/voice-core/ logs and click Retry.",
  };
}

async function* pullOllamaModel(modelId: string): AsyncGenerator<OllamaProgressEvent, void, undefined> {
  let resp: Response;
  try {
    resp = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId, stream: true }),
    });
  } catch (err) {
    yield { status: "failed", detail: (err as Error).message };
    return;
  }
  if (!resp.ok || !resp.body) {
    yield { status: "failed", detail: `ollama /api/pull → ${resp.status}` };
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line) continue;
      try {
        const j = JSON.parse(line) as {
          status?: string;
          total?: number;
          completed?: number;
          error?: string;
        };
        if (j.error) {
          const friendly = /no space left|enospc/i.test(j.error)
            ? `Your disk is full — free up space and retry (ollama keeps the partial cache, so retry resumes). Raw: ${j.error}`
            : j.error;
          yield { status: "failed", detail: friendly };
          return;
        }
        const pct =
          j.total && j.completed ? Math.min(1, j.completed / j.total) : undefined;
        const sizeNote =
          j.total && j.completed
            ? ` · ${fmtMb(j.completed)} / ${fmtMb(j.total)}`
            : "";
        yield {
          status: "running",
          detail: `${j.status ?? "downloading"}${sizeNote}`,
          progress: pct,
        };
        if (j.status === "success") {
          yield { status: "done", detail: "pulled" };
          return;
        }
      } catch {
        /* skip non-JSON line */
      }
    }
  }
  yield { status: "done", detail: "pulled" };
}

async function smokeTestLlm(
  modelId: string,
  smoke?: { prompt: string; num_predict: number; timeout_ms: number },
): Promise<{ ok: boolean; detail: string }> {
  const cfg = smoke ?? {
    prompt: "Say the word READY and nothing else.",
    num_predict: 64,
    timeout_ms: 60_000,
  };
  try {
    const start = Date.now();
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        prompt: cfg.prompt,
        stream: false,
        think: false,
        options: { num_predict: cfg.num_predict, temperature: 0 },
      }),
      signal: AbortSignal.timeout(cfg.timeout_ms),
    });
    if (!r.ok) {
      return { ok: false, detail: `ollama /api/generate → ${r.status}` };
    }
    // Reasoning models put output in `thinking` when /api/generate's
    // `think:false` toggle isn't honoured (older servers). Accept either —
    // we're proving the model can respond, not testing prompt adherence.
    const data = (await r.json()) as { response?: string; thinking?: string };
    const text = (data.response ?? data.thinking ?? "").trim();
    if (!text) return { ok: false, detail: "empty response" };
    return {
      ok: true,
      detail: `${text.slice(0, 40).replace(/\s+/g, " ")} · ${Date.now() - start} ms`,
    };
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError" || /aborted|timeout/i.test(e.message)) {
      return {
        ok: false,
        detail:
          "Smoke test timed out — first inference can be slow when ollama mmaps a large model. Wait 30 seconds and click Retry.",
      };
    }
    return { ok: false, detail: e.message };
  }
}

interface ChildLine {
  kind: "stdout" | "stderr" | "exit";
  text: string;
  code?: number | null;
}

/**
 * Spawn a child and yield each stdout/stderr line followed by a final exit event.
 * Used for the Ollama install so we can stream curl progress into the UI.
 */
async function* streamChild(cmd: CommandSpec): AsyncGenerator<ChildLine, void, undefined> {
  const child = spawn(cmd.bin, cmd.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: augmentedEnv(),
    windowsHide: true,
  });
  const queue: ChildLine[] = [];
  let resolveNext: (() => void) | null = null;
  let exited = false;
  let exitCode: number | null = null;

  const push = (line: ChildLine): void => {
    queue.push(line);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  const pipe = (stream: NodeJS.ReadableStream, kind: "stdout" | "stderr"): void => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (line) push({ kind, text: line });
      }
    });
    stream.on("end", () => {
      if (buf.trim()) push({ kind, text: buf });
    });
  };

  pipe(child.stdout!, "stdout");
  pipe(child.stderr!, "stderr");

  const timeoutMs = cmd.timeout_ms ?? 300_000;
  const timer = setTimeout(() => {
    if (!exited) {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }
  }, timeoutMs);
  timer.unref?.();

  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
    clearTimeout(timer);
    push({ kind: "exit", text: "", code });
  });
  child.on("error", (err) => {
    if (exited) return;
    exited = true;
    clearTimeout(timer);
    push({ kind: "exit", text: err.message, code: null });
  });

  while (true) {
    if (queue.length > 0) {
      const next = queue.shift()!;
      yield next;
      if (next.kind === "exit") return;
      continue;
    }
    if (exited && queue.length === 0) {
      // Should have emitted exit already; safety drain.
      yield { kind: "exit", text: "", code: exitCode };
      return;
    }
    await new Promise<void>((r) => (resolveNext = r));
  }
}

function trimLine(s: string): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? clean.slice(-80) : clean;
}

function runOnce(cmd: string, args: string[], timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "ignore", env: augmentedEnv(), windowsHide: true });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtMb(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }
  return (bytes / (1024 * 1024)).toFixed(0) + " MB";
}

// Useful for tests / introspection.
export const __internals = { HARDWARE_TIERS, streamChild, trimLine, requiresGraphicalAgent };
