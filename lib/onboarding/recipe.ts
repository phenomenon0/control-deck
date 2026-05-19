// Platform install-recipe loader. Each recipes/<platform>.yaml is declarative;
// the orchestrator stays generic. Validation fails loud at load time so we
// crash on boot rather than midway through a 5-minute install.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export type PlatformId = "linux" | "macos" | "windows";

export interface ConsentSpec {
  title: string;
  summary: string;
  /** Human-readable preview of what will run (for the disclosure block). */
  command_preview: string;
  /** Manual command shown if the user declines consent. */
  manual_fallback: string;
}

export interface CommandSpec {
  bin: string;
  args: string[];
  /** Detach + unref the child (used for `ollama serve`). */
  detach?: boolean;
  /** Hard timeout. Defaults to caller-supplied. */
  timeout_ms?: number;
  /** Exit code that means "yes, this worked" — defaults to 0. */
  expect_exit?: number;
}

export interface InstallSpec {
  consent: ConsentSpec;
  command: CommandSpec;
  verify: CommandSpec;
}

export interface ServiceSpec {
  start_attempts: CommandSpec[];
  /** Best-effort autostart enable so the service comes back after reboot. */
  enable_attempts?: CommandSpec[];
  fallback: CommandSpec;
  health_url: string;
  timeout_ms: number;
}

export interface SmokeSpec {
  prompt: string;
  num_predict: number;
  timeout_ms: number;
}

export interface PullSpec {
  throttle_ms: number;
  timeout_ms: number;
}

export interface Recipe {
  platform: PlatformId;
  ollama: {
    install: InstallSpec;
    service: ServiceSpec;
    pull: PullSpec;
  };
  smoke: SmokeSpec;
}

// Anchor recipes relative to this module, not the process CWD — survives
// packaged Electron builds where the user may launch from anywhere.
const RECIPE_DIR = join(dirname(fileURLToPath(import.meta.url)), "recipes");

function currentPlatform(): PlatformId {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

export function loadRecipe(platform?: PlatformId): Recipe {
  const pf = platform ?? currentPlatform();
  const path = join(RECIPE_DIR, `${pf}.yaml`);
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw) as unknown;
  return validateRecipe(parsed, pf, path);
}

function validateRecipe(value: unknown, expectedPlatform: PlatformId, path: string): Recipe {
  if (!isObject(value)) throw new Error(`${path}: root must be an object`);
  const platform = requireField(value, "platform", "string", path) as PlatformId;
  if (platform !== expectedPlatform) {
    throw new Error(`${path}: platform field is ${platform}, expected ${expectedPlatform}`);
  }
  const ollama = requireField(value, "ollama", "object", path) as Record<string, unknown>;
  const install = requireField(ollama, "install", "object", path) as Record<string, unknown>;
  const consent = requireField(install, "consent", "object", path) as Record<string, unknown>;
  const service = requireField(ollama, "service", "object", path) as Record<string, unknown>;
  const pull = requireField(ollama, "pull", "object", path) as Record<string, unknown>;
  const smoke = requireField(value, "smoke", "object", path) as Record<string, unknown>;

  return {
    platform,
    ollama: {
      install: {
        consent: {
          title: requireField(consent, "title", "string", path) as string,
          summary: requireField(consent, "summary", "string", path) as string,
          command_preview: requireField(consent, "command_preview", "string", path) as string,
          manual_fallback: requireField(consent, "manual_fallback", "string", path) as string,
        },
        command: validateCommand(install.command, `${path} → ollama.install.command`),
        verify: validateCommand(install.verify, `${path} → ollama.install.verify`),
      },
      service: {
        start_attempts: validateCommandList(service.start_attempts, `${path} → ollama.service.start_attempts`),
        enable_attempts:
          service.enable_attempts === undefined
            ? undefined
            : validateCommandList(service.enable_attempts, `${path} → ollama.service.enable_attempts`),
        fallback: validateCommand(service.fallback, `${path} → ollama.service.fallback`),
        health_url: requireField(service, "health_url", "string", path) as string,
        timeout_ms: requireField(service, "timeout_ms", "number", path) as number,
      },
      pull: {
        throttle_ms: requireField(pull, "throttle_ms", "number", path) as number,
        timeout_ms: requireField(pull, "timeout_ms", "number", path) as number,
      },
    },
    smoke: {
      prompt: requireField(smoke, "prompt", "string", path) as string,
      num_predict: requireField(smoke, "num_predict", "number", path) as number,
      timeout_ms: requireField(smoke, "timeout_ms", "number", path) as number,
    },
  };
}

function validateCommand(value: unknown, where: string): CommandSpec {
  if (!isObject(value)) throw new Error(`${where}: must be an object`);
  const bin = value.bin;
  const args = value.args;
  if (typeof bin !== "string") throw new Error(`${where}.bin: must be a string`);
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
    throw new Error(`${where}.args: must be a string[]`);
  }
  return {
    bin,
    args: args as string[],
    detach: value.detach === true,
    timeout_ms: typeof value.timeout_ms === "number" ? value.timeout_ms : undefined,
    expect_exit: typeof value.expect_exit === "number" ? value.expect_exit : undefined,
  };
}

function validateCommandList(value: unknown, where: string): CommandSpec[] {
  if (!Array.isArray(value)) throw new Error(`${where}: must be an array`);
  return value.map((v, i) => validateCommand(v, `${where}[${i}]`));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireField(obj: Record<string, unknown>, key: string, kind: "string" | "number" | "object", path: string): unknown {
  const v = obj[key];
  if (v === undefined || v === null) throw new Error(`${path}: missing required field "${key}"`);
  if (kind === "object") {
    if (!isObject(v) && !Array.isArray(v)) throw new Error(`${path}: "${key}" must be object/array`);
    return v;
  }
  if (typeof v !== kind) throw new Error(`${path}: "${key}" must be ${kind}`);
  return v;
}
