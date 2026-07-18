/**
 * Model routing for POST /api/chat.
 *
 * One resolver answers "which LLM?" for the whole deck. Precedence:
 * explicit request pick (composer providerId + DeckPrefs model) → slot
 * binding (Modalities UI / /api/inference/bindings) → settings-DB provider
 * URLs → LLM_* env → local Ollama default. See lib/engine/resolve.ts.
 */

import { getSystemProfile } from "@/lib/system";
import { resolveModelRoute, type ModelRoute } from "@/lib/engine/resolve";
import { defaultFor, type LocalPreset } from "@/lib/inference/local-defaults";
import {
  hasImageContent,
  type ChatRequestBody,
  type ClientMessage,
} from "./validate";

export interface ChatModelSelection {
  route: ModelRoute;
  selectedModel: string;
  /** True when any message carries image content (routes to the vision slot). */
  hasImages: boolean;
}

export async function resolveChatModel(input: {
  model?: string;
  providerId?: ChatRequestBody["providerId"];
  preset: LocalPreset;
  messages: ClientMessage[];
}): Promise<ChatModelSelection> {
  const systemProfile = getSystemProfile();
  const hasImages = hasImageContent(input.messages);

  const route = await resolveModelRoute({
    requested: input.model || input.providerId
      ? { provider: input.providerId, model: input.model }
      : null,
    slot: hasImages ? "vision::primary" : "text::primary",
  });

  // The resolver always names a model; the rungs below are the old
  // preset/systemProfile/hardcoded fallbacks, kept as a defensive net in
  // case a future route level can legitimately return an empty model.
  const presetLocalModel =
    defaultFor(hasImages ? "vision" : "text", input.preset).id ?? undefined;

  const selectedModel =
    route.model ||
    presetLocalModel ||
    systemProfile.recommended.textModel ||
    (hasImages ? "llama3.2-vision:11b" : "llama3.2:3b");

  return { route, selectedModel, hasImages };
}
