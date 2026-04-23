/**
 * llama.cpp server adapter. Default port 8080, override with
 * `LLAMACPP_BASE_URL`. llama.cpp exposes /v1/models for OpenAI-compat plus
 * /props for a richer model-info snapshot; we only consume /v1 here to
 * stay universal across llama.cpp forks.
 */

import { openAiCompatHealth, openAiCompatInstalled, openAiCompatLoaded } from "./openai-compat";
import type { ProviderAdapter } from "./types";
import { resolveProviderUrl } from "../settings";

function baseUrl(): string {
  return resolveProviderUrl("llamacpp");
}

export const llamacppAdapter: ProviderAdapter = {
  id: "llamacpp",
  label: "llama.cpp",
  origin: "ggerganov/llama.cpp",
  resolveUrl: baseUrl,
  capabilities: {
    // llama-server also binds one model at startup. Model switch = restart.
    load: false,
    unload: false,
    loadReason: "llama-server serves one model per process",
    unloadReason: "unload requires restarting llama-server",
  },
  health: () => openAiCompatHealth({ url: baseUrl() }),
  listInstalled: () => openAiCompatInstalled({ url: baseUrl() }),
  listLoaded: () => openAiCompatLoaded({ url: baseUrl() }),
};
