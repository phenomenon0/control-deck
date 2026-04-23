/**
 * vLLM adapter. Speaks OpenAI-compat at a configurable base URL.
 * `VLLM_BASE_URL` env overrides the default localhost:8000.
 */

import {
  openAiCompatHealth,
  openAiCompatInstalled,
  openAiCompatLoaded,
} from "./openai-compat";
import type { ProviderAdapter } from "./types";
import { resolveProviderUrl } from "../settings";

function baseUrl(): string {
  return resolveProviderUrl("vllm");
}

export const vllmAdapter: ProviderAdapter = {
  id: "vllm",
  label: "vLLM",
  origin: "vllm-project",
  resolveUrl: baseUrl,
  capabilities: {
    // vLLM binds a single model per process at launch time. Swapping means
    // restarting the server with a different --model arg. Not something we
    // automate from the browser.
    load: false,
    unload: false,
    loadReason: "vLLM is single-model-per-process — restart the server with --model",
    unloadReason: "vLLM evicts only on process exit",
  },
  health: () => openAiCompatHealth({ url: baseUrl() }),
  listInstalled: () => openAiCompatInstalled({ url: baseUrl() }),
  listLoaded: () => openAiCompatLoaded({ url: baseUrl() }),
};
