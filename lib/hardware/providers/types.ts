/**
 * Unified provider-adapter shape.
 *
 * Each local-inference provider (Ollama, vLLM, llama.cpp, LM Studio,
 * ComfyUI, etc.) implements this interface. The registry calls all enabled
 * adapters in parallel and merges the results for the Hardware page.
 *
 * Server-side only (individual adapters shell out or hit localhost). Types
 * live in this file and are safe to import from client code.
 */

export type ProviderId =
  | "ollama"
  | "vllm"
  | "llamacpp"
  | "lm-studio"
  | "comfyui"
  | "llamafile"
  | "localai"
  | "jan"
  | "oobabooga"
  | "tabbyapi"
  | "mlx"
  | "koboldcpp"
  | "custom";

export interface InstalledModelEntry {
  /** Stable identifier the provider uses (name / id / path tail). */
  name: string;
  /** Short display label — usually same as name. */
  displayName?: string;
  /** Quantisation label when known (Q4_K_M, fp16, etc). */
  quant?: string;
  /** Parameter size label (7B, 14B, etc). */
  params?: string;
  /** Family / base architecture when the provider exposes it. */
  family?: string;
  /** On-disk size in bytes. 0 when the provider doesn't report size. */
  sizeBytes: number;
  /** Absolute path on disk when the provider exposes it. */
  path?: string;
}

export interface LoadedModelEntry {
  name: string;
  /** Bytes resident in VRAM. 0 when the provider doesn't track. */
  sizeVramBytes: number;
  /** Bytes on disk. 0 when unknown. */
  sizeBytes: number;
  /** ISO timestamp when the model will be evicted, if the provider has such a concept. */
  expiresAt?: string;
}

export interface ProviderHealth {
  online: boolean;
  url: string;
  latencyMs?: number;
  version?: string;
  error?: string;
}

export interface ProviderCapabilities {
  /** Can the adapter load a specific model on demand? */
  load: boolean;
  /** Can the adapter evict a resident model? */
  unload: boolean;
  /** Optional reason shown in UI tooltip when a capability is disabled. */
  loadReason?: string;
  unloadReason?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  /** Human-readable label for cards + badges. */
  label: string;
  /** Brief origin — vendor / OSS project. */
  origin: string;
  /** Capability flags drive UI enable/disable + tooltip copy. */
  capabilities: ProviderCapabilities;
  /** Base URL this adapter uses. Resolves env vars + defaults. */
  resolveUrl(): string;
  /** Probe the base URL; fast check (≤ 2s). */
  health(): Promise<ProviderHealth>;
  /** List models registered / on disk for this provider. */
  listInstalled(): Promise<InstalledModelEntry[]>;
  /** List models currently resident (VRAM). Empty if provider has no notion of "loaded". */
  listLoaded(): Promise<LoadedModelEntry[]>;
  /** Warm a specific model into VRAM. Throws on failure or when `!capabilities.load`. */
  load?(name: string): Promise<void>;
  /** Evict a model. Throws on failure or when `!capabilities.unload`. */
  unload?(name: string): Promise<void>;
}

export interface ProviderSnapshot {
  id: ProviderId;
  label: string;
  origin: string;
  url: string;
  capabilities: ProviderCapabilities;
  health: ProviderHealth;
  installed: InstalledModelEntry[];
  loaded: LoadedModelEntry[];
  error?: string;
}
