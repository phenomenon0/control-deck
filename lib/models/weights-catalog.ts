/**
 * ComfyUI weights catalog (release-QA decisions B1/B2/B4) — the single
 * source of truth mapping every preset to the files it needs and every
 * file to a verified, non-gated download source.
 *
 * Sources are HuggingFace `resolve/main` URLs (integrity comes free via
 * the LFS etag sha256) or direct URLs with a pinned `sha256`. A file with
 * `url: null` has no verified source yet — the installer lists it as
 * "manual" instead of guessing.
 *
 * Consumed by lib/models/downloader.ts, /api/models/weights, and
 * scripts/download-image-models.sh (via scripts/download-weights.ts).
 */

import * as os from "node:os";
import * as path from "node:path";

export type WeightKind = "checkpoint" | "unet" | "text_encoder" | "vae" | "upscale";

export interface WeightFile {
  /** Stable key referenced by presets and the API. */
  key: string;
  /** Path relative to the kind's ComfyUI models dir (may include subdirs). */
  filename: string;
  kind: WeightKind;
  /** Verified direct download URL, or null when no non-gated source exists. */
  url: string | null;
  /** Pinned hash for non-HF URLs; HF files verify against the LFS etag. */
  sha256?: string;
  approxBytes?: number;
  notes?: string;
}

const COMFY_DIR = process.env.COMFY_DIR ?? path.join(os.homedir(), "ai", "ComfyUI");

const KIND_DIR: Record<WeightKind, string> = {
  checkpoint: "checkpoints",
  unet: "unet",
  text_encoder: "text_encoders",
  vae: "vae",
  upscale: "upscale_models",
};

export function weightAbsolutePath(file: WeightFile): string {
  return path.join(COMFY_DIR, "models", KIND_DIR[file.kind], file.filename);
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export const WEIGHT_FILES: WeightFile[] = [
  // Filled from verified sources — see scripts/download-image-models.sh
  {
    key: "sdxl-turbo-ckpt",
    filename: "sd_xl_turbo_1.0_fp16.safetensors",
    kind: "checkpoint",
    url: "https://huggingface.co/stabilityai/sdxl-turbo/resolve/main/sd_xl_turbo_1.0_fp16.safetensors",
    approxBytes: 6938081905,
  },
  {
    key: "sdxl-base-ckpt",
    filename: "sd_xl_base_1.0.safetensors",
    kind: "checkpoint",
    url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
    approxBytes: 6938078334,
  },
  {
    key: "flux-clip-l",
    filename: "FLUX/clip_l.safetensors",
    kind: "text_encoder",
    url: "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
    approxBytes: 246144152,
  },
  {
    key: "flux-t5xxl-fp16",
    filename: "FLUX/t5xxl_fp16.safetensors",
    kind: "text_encoder",
    url: "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors",
    approxBytes: 9787841024,
  },
  {
    key: "flux1-dev-q8-gguf",
    filename: "FLUX/flux1-dev-Q8_0.gguf",
    kind: "unet",
    url: "https://huggingface.co/city96/FLUX.1-dev-gguf/resolve/main/flux1-dev-Q8_0.gguf",
    approxBytes: 12708281504,
  },
  {
    key: "flux-vae",
    filename: "FLUX/diffusion_pytorch_model.safetensors",
    kind: "vae",
    url: "https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors",
    approxBytes: 335304388,
    notes: "FLUX.1 AE — BFL's FLUX.1-schnell repo went gated; Comfy-Org's Lumina 2 repackage carries the byte-identical AE",
  },
  {
    key: "flux-nunchaku-int4",
    filename: "NUNCHAKU/svdq-int4_r32-flux.1-dev.safetensors",
    kind: "unet",
    url: "https://huggingface.co/nunchaku-ai/nunchaku-flux.1-dev/resolve/main/svdq-int4_r32-flux.1-dev.safetensors",
    approxBytes: 6768309832,
    notes: "Nunchaku SVDQuant int4 (org renamed nunchaku-tech → nunchaku-ai)",
  },
  {
    key: "qwen-edit-unet",
    filename: "qwen-image-edit-2511-Q4_K_M.gguf",
    kind: "unet",
    url: "https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF/resolve/main/qwen-image-edit-2511-Q4_K_M.gguf",
    approxBytes: 13244758624,
    notes: "Qwen-Image-Edit 2511 Q4_K_M (unsloth is the canonical 2511 quant source)",
  },
  {
    key: "qwen-edit-clip",
    filename: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    kind: "text_encoder",
    url: "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
    approxBytes: 9384670680,
  },
  {
    key: "qwen-image-vae",
    filename: "qwen_image_vae.safetensors",
    kind: "vae",
    url: "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors",
    approxBytes: 253806246,
  },
  {
    key: "flux2-klein-q8-gguf",
    filename: "flux-2-klein-4b-Q8_0.gguf",
    kind: "unet",
    url: "https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q8_0.gguf",
    approxBytes: 4300644928,
    notes: "FLUX.2 klein 4B Q8_0",
  },
  {
    key: "qwen3-4b-te",
    filename: "qwen_3_4b.safetensors",
    kind: "text_encoder",
    url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
    approxBytes: 8044982048,
    notes: "Qwen3-4B text encoder (shared by z-image + flux2-klein workflows)",
  },
  {
    key: "z-image-turbo-unet",
    filename: "z_image_turbo_bf16.safetensors",
    kind: "unet",
    url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors",
    approxBytes: 12309866400,
    notes: "Tongyi Z-Image Turbo bf16",
  },
  {
    key: "flux2-vae",
    filename: "flux2-vae.safetensors",
    kind: "vae",
    url: "https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors",
    approxBytes: 336213556,
    notes: "FLUX.2 VAE",
  },
  {
    key: "flux-ae",
    filename: "ae.safetensors",
    kind: "vae",
    url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
    approxBytes: 335304388,
    notes: "FLUX AE for z-image (byte-identical to the FLUX/ copy; different dest path)",
  },
  {
    key: "realesrgan-x4plus",
    filename: "RealESRGAN_x4plus.pth",
    kind: "upscale",
    url: "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
    sha256: "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1",
    approxBytes: 67040989,
  },
  {
    key: "ultrasharp-x4",
    filename: "4x-UltraSharp.pth",
    kind: "upscale",
    url: "https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth",
    approxBytes: 66961958,
  },
  {
    key: "stable-audio-ckpt",
    filename: "stable-audio-open-1.0.safetensors",
    kind: "checkpoint",
    url: "https://huggingface.co/Comfy-Org/stable-audio-open-1.0_repackaged/resolve/main/stable-audio-open-1.0.safetensors",
    approxBytes: 4853889016,
    notes: "Stable Audio Open 1.0 — stabilityai repo went gated; Comfy-Org repackage bundles the T5",
  },
  {
    key: "stable-audio-t5",
    filename: "t5-base.safetensors",
    kind: "text_encoder",
    url: null,
    approxBytes: 890 * MB,
    notes: "Workflow loads t5-base.safetensors via CLIPLoader; the Comfy-Org repackaged checkpoint bundles T5 — verify whether this file is still needed before sourcing",
  },
  {
    key: "ace-step-ckpt",
    filename: "ace-step-v1.5.safetensors",
    kind: "checkpoint",
    url: null,
    approxBytes: 7 * GB,
    notes: "ACE-Step v1.5 — no verified non-gated single-file source yet; install manually",
  },
  {
    key: "hunyuan3d-ckpt",
    filename: "hunyuan_3d_v2.1.safetensors",
    kind: "checkpoint",
    url: "https://huggingface.co/Comfy-Org/hunyuan3D_2.1_repackaged/resolve/main/hunyuan_3d_v2.1.safetensors",
    approxBytes: 7365943290,
    notes: "Hunyuan3D 2.1 (Comfy-Org repackage)",
  },
];

const BY_KEY = new Map(WEIGHT_FILES.map((f) => [f.key, f]));

export function getWeightFile(key: string): WeightFile | undefined {
  return BY_KEY.get(key);
}

/** preset id → catalog keys. Mirrors PRESET_DEFINITIONS in lib/tools/comfyModels.ts. */
export const PRESET_WEIGHTS: Record<string, string[]> = {
  "sdxl-turbo": ["sdxl-turbo-ckpt"],
  "sdxl-t2i": ["sdxl-base-ckpt"],
  "flux-gguf": ["flux-clip-l", "flux-t5xxl-fp16", "flux1-dev-q8-gguf", "flux-vae"],
  "flux-nunchaku": ["flux-clip-l", "flux-t5xxl-fp16", "flux-nunchaku-int4", "flux-vae"],
  "qwen-edit": ["qwen-edit-unet", "qwen-edit-clip", "qwen-image-vae"],
  "flux2-klein": ["flux2-klein-q8-gguf", "qwen3-4b-te", "flux2-vae"],
  "z-image-turbo": ["z-image-turbo-unet", "qwen3-4b-te", "flux-ae"],
  upscale: ["realesrgan-x4plus"],
  "stable-audio": ["stable-audio-ckpt", "stable-audio-t5"],
  "ace-step": ["ace-step-ckpt"],
  "hunyuan-3d": ["hunyuan3d-ckpt"],
};

export function presetTotalBytes(preset: string): number {
  return (PRESET_WEIGHTS[preset] ?? [])
    .map((k) => BY_KEY.get(k)?.approxBytes ?? 0)
    .reduce((a, b) => a + b, 0);
}

/**
 * VRAM sizing basis for a preset. ComfyUI loads/offloads models
 * sequentially (text encoder → unet → vae), so peak residency tracks the
 * largest single file, not the sum — summing flags every multi-file
 * preset as "block" on a 24 GB card that runs them fine.
 */
export function presetVramBytes(preset: string): number {
  return (PRESET_WEIGHTS[preset] ?? [])
    .map((k) => BY_KEY.get(k)?.approxBytes ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
}
