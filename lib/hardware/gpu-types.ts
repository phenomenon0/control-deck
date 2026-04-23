/**
 * Isomorphic types + labels for GPU-process data. Safe to import from
 * client components — no Node-only deps. The server-side collector lives
 * in `gpu-processes.ts` and is imported only by the API route.
 */

export interface GpuProcess {
  pid: number;
  processName: string;
  usedMemoryMb: number;
  providerHint: ProviderHint;
}

export type ProviderHint =
  | "ollama"
  | "vllm"
  | "llamacpp"
  | "lm-studio"
  | "comfyui"
  | "whisper"
  | "piper"
  | "pytorch"
  | "other";

export const PROVIDER_LABEL: Record<ProviderHint, string> = {
  ollama: "Ollama",
  vllm: "vLLM",
  llamacpp: "llama.cpp",
  "lm-studio": "LM Studio",
  comfyui: "ComfyUI",
  whisper: "Whisper",
  piper: "Piper",
  pytorch: "PyTorch",
  other: "other",
};
