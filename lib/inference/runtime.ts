/**
 * Slot bindings — which provider is currently answering each (modality, slot).
 *
 * Mutable at runtime so the Settings UI can swap providers without a
 * restart; same intent as `setRuntimeProvider` in lib/llm/providers.ts:265.
 * Bindings are in-memory only; persistence is the caller's concern
 * (typically localStorage for UI prefs, env vars for server-side bootstrap).
 */

import type { Modality, SlotBinding } from "./types";

const bindings = new Map<string, SlotBinding>();

function key(modality: Modality, slot: string): string {
  return `${modality}::${slot}`;
}

export function bindSlot(binding: SlotBinding): void {
  bindings.set(key(binding.modality, binding.slotName), binding);
}

export function getSlot(modality: Modality, slotName = "primary"): SlotBinding | undefined {
  return bindings.get(key(modality, slotName));
}

export function listSlotsForModality(modality: Modality): SlotBinding[] {
  const out: SlotBinding[] = [];
  for (const binding of bindings.values()) {
    if (binding.modality === modality) out.push(binding);
  }
  return out;
}

export function clearSlot(modality: Modality, slotName = "primary"): void {
  bindings.delete(key(modality, slotName));
}

export function clearAllSlots(): void {
  bindings.clear();
}
