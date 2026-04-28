import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import type { Modality, SlotBinding } from "../types";

export const QWEN_OMNI_PROVIDER_ID = "qwen-omni-local";
export const QWEN_OMNI_MODEL_ID = "Qwen/Qwen2.5-Omni-7B-AWQ";
export const QWEN_OMNI_MODEL_LABEL = "Qwen2.5-Omni-7B-AWQ";
export const QWEN_OMNI_RELATIVE_DIR = "models/qwen2.5-omni-7b-awq";

export const QWEN_OMNI_SUPPORTED_MODALITIES = [
  "text",
  "vision",
  "stt",
  "tts",
] as const satisfies readonly Modality[];

export const QWEN_OMNI_DECK_MODALITIES: Array<{
  id: Modality;
  supported: boolean;
  role: "native" | "not-supported";
  note: string;
}> = [
  { id: "text", supported: true, role: "native", note: "Language reasoning and assistant turns." },
  { id: "vision", supported: true, role: "native", note: "Image and video understanding through the Omni thinker." },
  { id: "stt", supported: true, role: "native", note: "Audio input understood by the same model." },
  { id: "tts", supported: true, role: "native", note: "Speech output through the Omni talker." },
  { id: "image-gen", supported: false, role: "not-supported", note: "Understands images; does not generate images." },
  { id: "audio-gen", supported: false, role: "not-supported", note: "Speech output only, not music or SFX generation." },
  { id: "embedding", supported: false, role: "not-supported", note: "No embedding head exposed by this model." },
  { id: "rerank", supported: false, role: "not-supported", note: "No cross-encoder rerank head exposed by this model." },
  { id: "3d-gen", supported: false, role: "not-supported", note: "No 3D generation capability." },
  { id: "video-gen", supported: false, role: "not-supported", note: "Understands video; does not generate video." },
];

const DEFAULT_MIN_WEIGHT_BYTES = 10 * 1024 ** 3;
const SIDECAR_PROBE_TIMEOUT_MS = 800;

export interface QwenOmniSidecarStatus {
  configured: boolean;
  baseURL: string | null;
  reachable: boolean | null;
  detail: string | null;
}

export interface QwenOmniStatus {
  providerId: typeof QWEN_OMNI_PROVIDER_ID;
  modelId: typeof QWEN_OMNI_MODEL_ID;
  modelLabel: typeof QWEN_OMNI_MODEL_LABEL;
  modelDir: string;
  relativeDir: typeof QWEN_OMNI_RELATIVE_DIR;
  installed: boolean;
  ready: boolean;
  weightsBytes: number;
  shardCount: number;
  hasProcessor: boolean;
  hasTokenizer: boolean;
  hasAwqQuantization: boolean;
  audioOutputEnabled: boolean;
  cudaAvailable: boolean | null;
  generationReady: boolean;
  sidecar: QwenOmniSidecarStatus;
  supportedModalities: readonly Modality[];
  deckModalities: typeof QWEN_OMNI_DECK_MODALITIES;
  issues: string[];
  smokeCommand: string;
  fullSmokeCommand: string;
}

interface StatusOptions {
  modelDir?: string;
  minWeightBytes?: number;
  probeRuntime?: boolean;
  /** When true, the helper will also fetch `${sidecarUrl}/health`. */
  probeSidecar?: boolean;
}

interface OmniConfig {
  model_type?: string;
  enable_audio_output?: boolean;
  enable_talker?: boolean;
  quantization_config?: {
    bits?: number;
    quant_method?: string;
  };
}

let cachedCudaAvailable: boolean | undefined;

export function qwenOmniModelDir(): string {
  return path.resolve(process.env.QWEN_OMNI_MODEL_DIR ?? QWEN_OMNI_RELATIVE_DIR);
}

export function qwenOmniSidecarUrl(): string | null {
  const raw = process.env.OMNI_SIDECAR_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function isQwenOmniRepo(repo: string | undefined): boolean {
  return repo === QWEN_OMNI_MODEL_ID;
}

export function qwenOmniBinding(modality: Modality, modelDir = qwenOmniModelDir()): SlotBinding {
  return {
    modality,
    slotName: "primary",
    providerId: QWEN_OMNI_PROVIDER_ID,
    config: {
      providerId: QWEN_OMNI_PROVIDER_ID,
      model: QWEN_OMNI_MODEL_ID,
      baseURL: modelDir,
      extras: {
        modelDir,
        localModel: true,
        e2eVoiceAssistant: true,
        sidecarUrl: qwenOmniSidecarUrl(),
        fallbackProviderId: "voice-core",
        fallbackBaseURL: process.env.VOICE_CORE_URL ?? "http://127.0.0.1:4245",
      },
    },
  };
}

export function getQwenOmniStatus(options: StatusOptions = {}): QwenOmniStatus {
  const modelDir = path.resolve(options.modelDir ?? qwenOmniModelDir());
  const minWeightBytes = options.minWeightBytes ?? DEFAULT_MIN_WEIGHT_BYTES;
  const issues: string[] = [];

  const installed = fs.existsSync(modelDir) && safeStat(modelDir)?.isDirectory() === true;
  let weightsBytes = 0;
  let shardCount = 0;
  let hasProcessor = false;
  let hasTokenizer = false;
  let hasAwqQuantization = false;
  let audioOutputEnabled = false;

  if (!installed) {
    issues.push(`Missing model directory: ${modelDir}`);
  } else {
    const names = safeReadDir(modelDir);
    const incomplete = names.filter((name) => name.endsWith(".incomplete"));
    if (incomplete.length > 0) {
      issues.push(`Incomplete download artifacts remain: ${incomplete.join(", ")}`);
    }

    const shards = names.filter((name) => /^model-\d{5}-of-\d{5}\.safetensors$/.test(name));
    shardCount = shards.length;
    weightsBytes = readSafetensorsTotalSize(path.join(modelDir, "model.safetensors.index.json")) ?? 0;
    if (shardCount === 0) issues.push("No safetensors model shards found.");
    if (weightsBytes < minWeightBytes) {
      issues.push(`Model weights are too small: ${formatGiB(weightsBytes)} GiB found.`);
    }

    const config = readConfig(path.join(modelDir, "config.json"));
    if (!config) {
      issues.push("config.json missing or unreadable.");
    } else {
      if (config.model_type !== "qwen2_5_omni") {
        issues.push(`Unexpected model_type: ${String(config.model_type ?? "missing")}`);
      }
      audioOutputEnabled = config.enable_audio_output === true || config.enable_talker === true;
      if (!audioOutputEnabled) issues.push("Audio output is not enabled in config.json.");
      hasAwqQuantization =
        config.quantization_config?.quant_method === "awq" &&
        config.quantization_config?.bits === 4;
      if (!hasAwqQuantization) issues.push("AWQ 4-bit quantization config is missing.");
    }

    hasProcessor = names.includes("preprocessor_config.json") || names.includes("processor_config.json");
    hasTokenizer = names.includes("tokenizer.json") || names.includes("tokenizer_config.json");
    if (!hasProcessor) issues.push("Processor config is missing.");
    if (!hasTokenizer) issues.push("Tokenizer config is missing.");
  }

  const snapshotReady = installed && issues.length === 0;
  const cudaAvailable = options.probeRuntime ? detectCudaAvailable() : null;
  const sidecarUrl = qwenOmniSidecarUrl();
  const sidecar: QwenOmniSidecarStatus = sidecarUrl
    ? { configured: true, baseURL: sidecarUrl, reachable: null, detail: null }
    : { configured: false, baseURL: null, reachable: null, detail: null };
  return finalizeStatus({
    modelDir,
    installed,
    snapshotReady,
    cudaAvailable,
    weightsBytes,
    shardCount,
    hasProcessor,
    hasTokenizer,
    hasAwqQuantization,
    audioOutputEnabled,
    sidecar,
    issues,
  });
}

interface StatusBuildArgs {
  modelDir: string;
  installed: boolean;
  snapshotReady: boolean;
  cudaAvailable: boolean | null;
  weightsBytes: number;
  shardCount: number;
  hasProcessor: boolean;
  hasTokenizer: boolean;
  hasAwqQuantization: boolean;
  audioOutputEnabled: boolean;
  sidecar: QwenOmniSidecarStatus;
  issues: string[];
}

function finalizeStatus(args: StatusBuildArgs): QwenOmniStatus {
  const { snapshotReady, cudaAvailable, sidecar } = args;
  const issues = [...args.issues];
  const hasRuntime = cudaAvailable === true || sidecar.reachable === true;
  if (snapshotReady && cudaAvailable === false && !sidecar.reachable) {
    issues.push(
      "CUDA/NVIDIA runtime is not available; full local speech generation needs CUDA or a reachable Omni sidecar.",
    );
  }
  if (sidecar.configured && sidecar.reachable === false) {
    issues.push(`Omni sidecar configured at ${sidecar.baseURL} but not reachable.`);
  }

  return {
    providerId: QWEN_OMNI_PROVIDER_ID,
    modelId: QWEN_OMNI_MODEL_ID,
    modelLabel: QWEN_OMNI_MODEL_LABEL,
    modelDir: args.modelDir,
    relativeDir: QWEN_OMNI_RELATIVE_DIR,
    installed: args.installed,
    ready: snapshotReady,
    weightsBytes: args.weightsBytes,
    shardCount: args.shardCount,
    hasProcessor: args.hasProcessor,
    hasTokenizer: args.hasTokenizer,
    hasAwqQuantization: args.hasAwqQuantization,
    audioOutputEnabled: args.audioOutputEnabled,
    cudaAvailable,
    generationReady: snapshotReady && hasRuntime,
    sidecar,
    supportedModalities: QWEN_OMNI_SUPPORTED_MODALITIES,
    deckModalities: QWEN_OMNI_DECK_MODALITIES,
    issues,
    smokeCommand: `python3 scripts/qwen-omni-smoke.py --model-dir ${QWEN_OMNI_RELATIVE_DIR}`,
    fullSmokeCommand: `python3 scripts/qwen-omni-smoke.py --model-dir ${QWEN_OMNI_RELATIVE_DIR} --full`,
  };
}

export async function getQwenOmniStatusAsync(
  options: StatusOptions = {},
): Promise<QwenOmniStatus> {
  const sync = getQwenOmniStatus(options);
  if (!options.probeSidecar) return sync;
  const sidecar = await probeQwenOmniSidecar();
  return finalizeStatus({
    modelDir: sync.modelDir,
    installed: sync.installed,
    snapshotReady: sync.ready,
    cudaAvailable: sync.cudaAvailable,
    weightsBytes: sync.weightsBytes,
    shardCount: sync.shardCount,
    hasProcessor: sync.hasProcessor,
    hasTokenizer: sync.hasTokenizer,
    hasAwqQuantization: sync.hasAwqQuantization,
    audioOutputEnabled: sync.audioOutputEnabled,
    sidecar,
    issues: sync.issues.filter(
      (msg) =>
        !msg.startsWith("CUDA/NVIDIA runtime is not available") &&
        !msg.startsWith("Omni sidecar configured at"),
    ),
  });
}

export async function probeQwenOmniSidecar(): Promise<QwenOmniSidecarStatus> {
  const baseURL = qwenOmniSidecarUrl();
  if (!baseURL) {
    return { configured: false, baseURL: null, reachable: null, detail: null };
  }
  try {
    const res = await fetch(`${baseURL}/health`, {
      signal: AbortSignal.timeout(SIDECAR_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        configured: true,
        baseURL,
        reachable: false,
        detail: `health ${res.status}`,
      };
    }
    const detail = await res
      .json()
      .then((data: unknown) => {
        if (data && typeof data === "object" && "model" in data) {
          const model = (data as { model?: unknown }).model;
          if (typeof model === "string" && model.length > 0) return `model=${model}`;
        }
        return null;
      })
      .catch(() => null);
    return { configured: true, baseURL, reachable: true, detail };
  } catch (err) {
    return {
      configured: true,
      baseURL,
      reachable: false,
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
}

function detectCudaAvailable(): boolean {
  if (cachedCudaAvailable !== undefined) return cachedCudaAvailable;
  if (process.env.QWEN_OMNI_ASSUME_CUDA === "1") {
    cachedCudaAvailable = true;
    return cachedCudaAvailable;
  }
  try {
    execFileSync("nvidia-smi", ["-L"], {
      encoding: "utf8",
      timeout: 800,
      stdio: ["ignore", "pipe", "ignore"],
    });
    cachedCudaAvailable = true;
  } catch {
    cachedCudaAvailable = false;
  }
  return cachedCudaAvailable;
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function readConfig(p: string): OmniConfig | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as OmniConfig;
  } catch {
    return null;
  }
}

function readSafetensorsTotalSize(p: string): number | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as {
      metadata?: { total_size?: unknown };
    };
    const total = parsed.metadata?.total_size;
    return typeof total === "number" && Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2);
}
