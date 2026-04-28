export const LOCAL_PROVIDER_IDS = new Set([
  "ollama",
  "voice-core",
  "comfyui",
  "lite-onnx",
  "llama_server",
  "vllm",
  "lmstudio",
  "custom",
  "bge",
  "vectordb-internal",
  "qwen-omni-local",
]);

export function isLocalProviderId(providerId: string): boolean {
  return LOCAL_PROVIDER_IDS.has(providerId);
}
