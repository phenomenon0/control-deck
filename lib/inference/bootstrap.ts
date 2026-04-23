/**
 * Idempotent bootstrap for the inference registry.
 *
 * Callers (API routes, UI components, tool executors) invoke
 * `ensureBootstrap()` before touching the registry or runtime. Calling it
 * more than once is safe; the underlying register functions short-circuit
 * on re-entry.
 *
 * Not auto-invoked on module import — we keep the side-effect explicit so
 * that test harnesses and one-off scripts can opt in or out.
 */

import { registerTextProviders } from "./text/register";
import { registerVisionProviders } from "./vision/register";
import { registerImageGenProviders } from "./image-gen/register";
import { registerAudioGenProviders } from "./audio-gen/register";
import { registerTtsProviders } from "./tts/register";
import { registerSttProviders } from "./stt/register";
import { registerEmbeddingProviders } from "./embedding/register";
import { registerRerankProviders } from "./rerank/register";
import { register3dGenProviders } from "./3d-gen/register";
import { registerVideoGenProviders } from "./video-gen/register";
import { applyPersistedBindings } from "./persistence";

let bootstrapped = false;

export function ensureBootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  registerTextProviders();
  registerVisionProviders();
  registerImageGenProviders();
  registerAudioGenProviders();
  registerTtsProviders();
  registerSttProviders();
  registerEmbeddingProviders();
  registerRerankProviders();
  register3dGenProviders();
  registerVideoGenProviders();
  // Run LAST so persisted UI-set bindings override env-var defaults.
  applyPersistedBindings();
}

// Re-exports so callers have a single import surface.
export { registerProvider, getProvider, listProvidersForModality, allProviders } from "./registry";
export { bindSlot, getSlot, listSlotsForModality, clearSlot, clearAllSlots } from "./runtime";
export { MODALITIES } from "./types";
export type {
  Modality,
  ModalityMeta,
  InferenceProvider,
  InferenceProviderConfig,
  SlotBinding,
} from "./types";
