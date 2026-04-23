/**
 * Hardware settings resolver — bridges the Zod-validated `hardware` section
 * from `lib/settings/schema` with the provider adapters / scanner modules.
 *
 * Each adapter used to hard-code an env var (`OLLAMA_BASE_URL` etc) and a
 * localhost default. That still works — it's the lowest-priority layer —
 * but a user-set URL in Settings > Hardware now overrides it.
 *
 * Resolution order for `resolveProviderUrl(id)`:
 *   1. settings.hardware.providerUrls[id]   (if non-empty)
 *   2. envOverride[id] (OLLAMA_BASE_URL etc) (if present)
 *   3. hardcoded localhost default
 */

import type { SettingsProviderId } from "@/lib/settings/schema";

const ENV_VAR: Record<SettingsProviderId, string> = {
  ollama: "OLLAMA_BASE_URL",
  vllm: "VLLM_BASE_URL",
  llamacpp: "LLAMACPP_BASE_URL",
  "lm-studio": "LM_STUDIO_BASE_URL",
  comfyui: "COMFYUI_BASE_URL",
};

const DEFAULTS: Record<SettingsProviderId, string> = {
  ollama: "http://localhost:11434",
  vllm: "http://localhost:8000",
  llamacpp: "http://localhost:8080",
  "lm-studio": "http://localhost:1234",
  comfyui: "http://localhost:8188",
};

function readHardwareSection():
  | {
      enabledProviders?: SettingsProviderId[];
      providerUrls?: Partial<Record<SettingsProviderId, string>>;
      vramReserveMb?: number;
      ggufSearchRoots?: string[];
    }
  | null {
  // Lazy-resolve so tests that don't have a DB don't blow up.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSection } = require("@/lib/settings/resolve") as typeof import("@/lib/settings/resolve");
    return resolveSection("hardware");
  } catch {
    return null;
  }
}

export function resolveProviderUrl(id: SettingsProviderId): string {
  const settings = readHardwareSection();
  const override = settings?.providerUrls?.[id];
  if (override && override.trim()) return normalise(override.trim());

  const envRaw = process.env[ENV_VAR[id]];
  if (envRaw && envRaw.trim()) return normalise(envRaw.trim());

  return DEFAULTS[id];
}

export function isProviderEnabled(id: SettingsProviderId): boolean {
  const settings = readHardwareSection();
  if (!settings?.enabledProviders) return true;
  return settings.enabledProviders.includes(id);
}

export function resolveVramReserveMb(): number {
  const settings = readHardwareSection();
  const fromSettings = settings?.vramReserveMb;
  if (typeof fromSettings === "number" && fromSettings >= 0) return fromSettings;

  const envRaw = process.env.DECK_VRAM_RESERVE_MB;
  if (envRaw) {
    const n = Number.parseInt(envRaw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 2048;
}

export function resolveGgufSearchRoots(): string[] {
  const settings = readHardwareSection();
  return settings?.ggufSearchRoots ?? [];
}

function normalise(url: string): string {
  // Ollama's OLLAMA_BASE_URL sometimes has /v1 appended; adapters all speak
  // the native API, so we strip it.
  return url.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}
