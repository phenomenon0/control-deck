import { registerProvider } from "../registry";
import type { InferenceProvider, Modality } from "../types";
import {
  getQwenOmniStatus,
  QWEN_OMNI_MODEL_ID,
  QWEN_OMNI_PROVIDER_ID,
  QWEN_OMNI_RELATIVE_DIR,
  QWEN_OMNI_SUPPORTED_MODALITIES,
} from "./local";

let registered = false;

export function registerOmniProviders(): void {
  if (registered) return;
  registered = true;

  registerProvider({
    id: QWEN_OMNI_PROVIDER_ID,
    name: "Qwen2.5 Omni AWQ (local)",
    description:
      "Downloaded local end-to-end voice assistant model: text, image/video understanding, audio input, and speech output.",
    modalities: [...QWEN_OMNI_SUPPORTED_MODALITIES],
    requiresApiKey: false,
    defaultBaseURL: QWEN_OMNI_RELATIVE_DIR,
    defaultModels: defaultsFor(QWEN_OMNI_SUPPORTED_MODALITIES),
    checkHealth: async () => getQwenOmniStatus().ready,
    listModels: async () => (getQwenOmniStatus().ready ? [QWEN_OMNI_MODEL_ID] : []),
  });
}

function defaultsFor(modalities: readonly Modality[]): InferenceProvider["defaultModels"] {
  const out: InferenceProvider["defaultModels"] = {};
  for (const modality of modalities) {
    out[modality] = [QWEN_OMNI_MODEL_ID];
  }
  return out;
}
