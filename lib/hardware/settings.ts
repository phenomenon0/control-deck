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
 *   3. secondary env var, where one exists (OLLAMA_URL for ollama,
 *      LLAMA_SWAP_BASE_URL for llamacpp)
 *   4. hardcoded localhost default
 *
 * Every consumer of a provider base URL should go through this resolver —
 * reading OLLAMA_BASE_URL directly bypasses the Settings UI layer and is
 * enforced against by scripts/contract-check.ts.
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

interface HardwareSection {
  enabledProviders?: SettingsProviderId[];
  providerUrls?: Partial<Record<SettingsProviderId, string>>;
  vramReserveMb?: number;
  ggufSearchRoots?: string[];
}

function readHardwareSection(): HardwareSection | null {
  // Lazy-resolve so tests that don't have a DB don't blow up. Under `bun test`
  // this always lands in the catch: lib/agui/db needs better-sqlite3, which
  // Bun can't load — the settings layer then degrades to env + defaults.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSection } = require("@/lib/settings/resolve") as typeof import("@/lib/settings/resolve");
    return resolveSection("hardware");
  } catch {
    return null;
  }
}

// Active section reader. Production always uses readHardwareSection; tests
// swap it via __test below because the DB-backed reader is unreachable under
// Bun (see above).
let activeReader: () => HardwareSection | null = readHardwareSection;

/** Test seam — mirrors the `__test` exports in lane-adapters/orchestrator. */
export const __test = {
  setHardwareSectionReader(reader: (() => HardwareSection | null) | null): void {
    activeReader = reader ?? readHardwareSection;
  },
};

export function resolveProviderUrl(id: SettingsProviderId): string {
  const settings = activeReader();
  const override = settings?.providerUrls?.[id];
  if (override && override.trim()) return normalise(override.trim());

  // llamacpp has a second canonical env var — LLAMA_SWAP_BASE_URL — because
  // the chat lane is backed by mostlygeek/llama-swap in this deployment.
  // Honour it first so callers don't have to know which name to set.
  if (id === "llamacpp") {
    const swapRaw = process.env.LLAMA_SWAP_BASE_URL;
    if (swapRaw && swapRaw.trim()) return normalise(swapRaw.trim());
  }

  const envRaw = process.env[ENV_VAR[id]];
  if (envRaw && envRaw.trim()) return normalise(envRaw.trim());

  // Ollama has a second historical env var — OLLAMA_URL — honoured by older
  // call sites alongside OLLAMA_BASE_URL. Keep it as a fallback so migrating
  // those call sites here doesn't silently drop a working override.
  if (id === "ollama") {
    const altRaw = process.env.OLLAMA_URL;
    if (altRaw && altRaw.trim()) return normalise(altRaw.trim());
  }

  return DEFAULTS[id];
}

export function isProviderEnabled(id: SettingsProviderId): boolean {
  const settings = activeReader();
  if (!settings?.enabledProviders) return true;
  return settings.enabledProviders.includes(id);
}

export function resolveVramReserveMb(): number {
  const settings = activeReader();
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
  const settings = activeReader();
  return settings?.ggufSearchRoots ?? [];
}

function normalise(url: string): string {
  // Ollama's OLLAMA_BASE_URL sometimes has /v1 appended; adapters all speak
  // the native API, so we strip it.
  return url.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}
