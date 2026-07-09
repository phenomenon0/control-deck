/**
 * LLM endpoint presets for the Voice Lab: map user-facing engine choices
 * (Ollama, llama.cpp, vLLM, LM Studio, the deck agent bridge) onto the raw
 * s2s LaunchConfig fields (llm_backend + responses_api_base_url + model_name).
 *
 * Pure module — imported by both the client store and the
 * /api/voice/llm-models route.
 */

export type LlmEndpointId =
  | "agent"
  | "ollama"
  | "llamacpp"
  | "llamaswap"
  | "vllm"
  | "lm-studio"
  | "custom";

/** Providers the /api/voice/llm-models route can resolve and probe. */
export const LLM_MODEL_PROVIDERS = ["ollama", "llamacpp", "vllm", "lm-studio"] as const;
export type LlmModelsProvider = (typeof LLM_MODEL_PROVIDERS)[number];

export interface LlmEndpointOption {
  id: LlmEndpointId;
  label: string;
  help: string;
  /** Provider id used for URL resolution + model listing; null = no fetch. */
  provider: LlmModelsProvider | null;
}

export const LLM_ENDPOINT_OPTIONS: readonly LlmEndpointOption[] = [
  {
    id: "agent",
    label: "Deck agent (tools, memory)",
    help: "Voice turns ride the deck's agent spine — tools, approvals, thread memory. The deck's router picks the model.",
    provider: null,
  },
  {
    id: "ollama",
    label: "Ollama",
    help: "Ollama's OpenAI-compatible endpoint (default :11434/v1). Fastest way to swap local models.",
    provider: "ollama",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    help: "llama-server's /v1 endpoint (default :8080). Serves the single model it was launched with.",
    provider: "llamacpp",
  },
  {
    id: "llamaswap",
    label: "llama-swap",
    help: "llama-swap fronting multiple llama-server children on one /v1 port (resolved like llama.cpp).",
    provider: "llamacpp",
  },
  {
    id: "vllm",
    label: "vLLM",
    help: "vLLM's OpenAI server (default :8000/v1). Start it yourself with `vllm serve <model>`.",
    provider: "vllm",
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    help: "LM Studio's local server /v1 (default :1234). Enable the server in LM Studio first.",
    provider: "lm-studio",
  },
  {
    id: "custom",
    label: "Custom URL",
    help: "Any OpenAI-compatible /v1 endpoint — edit the base URL field below.",
    provider: null,
  },
];

/** Normalize an engine base URL to its OpenAI-compatible /v1 root. */
export function openAiBaseUrl(raw: string): string {
  const base = raw.replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

const PORT_TO_ENDPOINT: Record<string, LlmEndpointId> = {
  "11434": "ollama",
  "8080": "llamacpp",
  "8000": "vllm",
  "1234": "lm-studio",
};

/**
 * Best-effort mapping from a configured base URL back to a picker choice.
 * Local engines are distinguished by their conventional ports; llama-swap
 * shares :8080 with llama.cpp and derives to llamacpp. Anything else is a
 * custom URL.
 */
export function deriveLlmEndpoint(url: string | null | undefined, agentUrl: string): LlmEndpointId {
  if (!url) return "custom";
  if (url === agentUrl) return "agent";
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/agent-bridge/")) return "agent";
    return PORT_TO_ENDPOINT[parsed.port] ?? "custom";
  } catch {
    return "custom";
  }
}
