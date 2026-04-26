/**
 * After a tier bundle finishes pulling, write its STT / TTS / text picks
 * into the persisted slot-binding store so the rest of the app immediately
 * routes through the new models.
 *
 * Called from `app/api/voice/bundles/route.ts` once all pulls succeed.
 */

import { savePersistedBinding, setSelectedTier } from "../persistence";
import { getTier, type TierId } from "../hardware-tiers";
import { QWEN_OMNI_PROVIDER_ID } from "../omni/local";

interface BindTierOpts {
  /** Whether the user opted into the tier's omni lane. */
  omni?: boolean;
}

/**
 * Bind the cascade slots (stt + tts + text fast/primary) for a tier and
 * persist the user's choice. Idempotent — safe to call multiple times.
 *
 * Note on text: we don't bind the text slot here because text providers are
 * picked from `lib/llm/providers.ts`, which the user controls via the chat
 * model picker. We only emit a hint in the data file via `setSelectedTier`
 * — the tier card UI shows the recommended LLM and offers a one-click
 * "use this LLM" button.
 */
export function bindTier(tierId: TierId, opts: BindTierOpts = {}): void {
  const tier = getTier(tierId);

  // STT primary → voice-api provider with the tier's STT engine id as model.
  // The invoke layer routes the request to the right sidecar (port 8000 vs 9101)
  // based on the model id.
  savePersistedBinding({
    modality: "stt",
    slotName: "primary",
    providerId: "voice-api",
    config: {
      providerId: "voice-api",
      model: tier.cascade.stt.id,
    },
  });

  // TTS primary → voice-api provider with the tier's TTS engine id.
  savePersistedBinding({
    modality: "tts",
    slotName: "primary",
    providerId: "voice-api",
    config: {
      providerId: "voice-api",
      model: tier.cascade.tts.id,
      extras: { engine: tier.cascade.tts.id },
    },
  });

  // Optional omni lane — only present on tiers that ship one.
  if (opts.omni && tier.omni) {
    if (tier.omni.sidecar === "qwen-omni") {
      // Activates Qwen-Omni across stt/tts/text/vision via the existing path.
      // The bundle API also pings /api/voice/omni to flip the runtime flags.
      savePersistedBinding({
        modality: "stt",
        slotName: "primary",
        providerId: QWEN_OMNI_PROVIDER_ID,
        config: { providerId: QWEN_OMNI_PROVIDER_ID, model: tier.omni.modelId },
      });
      savePersistedBinding({
        modality: "tts",
        slotName: "primary",
        providerId: QWEN_OMNI_PROVIDER_ID,
        config: { providerId: QWEN_OMNI_PROVIDER_ID, model: tier.omni.modelId },
      });
    }
    // Moshi (sidecar: voice-engines) doesn't yet have a registered provider
    // — it's exposed via the same voice-engines sidecar as a special engine
    // id. The Conductor surface checks `selectedTierOmni` to decide whether
    // to open a WS to /omni instead of cascading through stt+tts.
  }

  setSelectedTier(tierId, { omni: opts.omni });
}
