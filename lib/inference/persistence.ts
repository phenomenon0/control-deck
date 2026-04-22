/**
 * Slot-binding persistence.
 *
 * Writes to a JSON file at $CONTROL_DECK_USER_DATA/inference-bindings.json
 * (packaged Electron build) or ./data/inference-bindings.json (dev).
 *
 * Precedence applied at bootstrap:
 *   1. persisted file (user's UI-set choice)
 *   2. env vars (per-modality register.ts reads TTS_PROVIDER etc.)
 *   3. no binding (modality unavailable unless a caller provides its own
 *      config, as with text which uses lib/llm/providers.ts directly)
 *
 * The persistence is intentionally simple — a single JSON blob, no DB,
 * no migrations. Failure to read or write is non-fatal; the runtime
 * falls back to env-only bindings.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { bindSlot, clearSlot } from "./runtime";
import type { Modality, SlotBinding } from "./types";

const FILENAME = "inference-bindings.json";

function resolvePath(): string {
  const base =
    process.env.CONTROL_DECK_USER_DATA ??
    path.join(process.cwd(), "data");
  return path.join(base, FILENAME);
}

interface PersistedBindings {
  version: 1;
  bindings: Record<string, SlotBinding>; // key: `${modality}::${slotName}`
}

function emptyStore(): PersistedBindings {
  return { version: 1, bindings: {} };
}

function keyFor(modality: Modality, slotName: string): string {
  return `${modality}::${slotName}`;
}

export function readPersistedBindings(): PersistedBindings {
  const p = resolvePath();
  try {
    if (!fs.existsSync(p)) return emptyStore();
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedBindings>;
    if (parsed?.version === 1 && parsed.bindings && typeof parsed.bindings === "object") {
      return { version: 1, bindings: parsed.bindings };
    }
    return emptyStore();
  } catch (err) {
    console.warn("[inference] failed to read persisted bindings:", err);
    return emptyStore();
  }
}

function writePersistedBindings(store: PersistedBindings): void {
  const p = resolvePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("[inference] failed to write persisted bindings:", err);
    throw err;
  }
}

/**
 * Replay all persisted bindings into the runtime. Called from bootstrap
 * after each register.ts has applied its env-var default so persisted
 * values win.
 */
export function applyPersistedBindings(): void {
  const store = readPersistedBindings();
  for (const binding of Object.values(store.bindings)) {
    if (!binding.modality || !binding.slotName || !binding.providerId) continue;
    bindSlot(binding);
  }
}

export function savePersistedBinding(binding: SlotBinding): void {
  const store = readPersistedBindings();
  store.bindings[keyFor(binding.modality, binding.slotName)] = binding;
  writePersistedBindings(store);
  bindSlot(binding);
}

export function deletePersistedBinding(modality: Modality, slotName: string): void {
  const store = readPersistedBindings();
  delete store.bindings[keyFor(modality, slotName)];
  writePersistedBindings(store);
  clearSlot(modality, slotName);
}

export function listPersistedBindings(): SlotBinding[] {
  const store = readPersistedBindings();
  return Object.values(store.bindings);
}
