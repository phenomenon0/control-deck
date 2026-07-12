import {
  FLUX2_KLEIN_CLIP,
  FLUX2_KLEIN_UNET,
  FLUX2_KLEIN_VAE,
  Z_IMAGE_CLIP,
  Z_IMAGE_UNET,
  Z_IMAGE_VAE,
  FLUX_GGUF_CLIP_L,
  FLUX_GGUF_T5XXL,
  FLUX_GGUF_UNET,
  FLUX_GGUF_VAE,
  FLUX_NUNCHAKU_MODEL,
  QWEN_EDIT_CLIP,
  QWEN_EDIT_UNET,
  QWEN_EDIT_VAE,
  SDXL_BASE_CHECKPOINT,
  SDXL_TURBO_CHECKPOINT,
  UPSCALE_MODEL,
} from "./workflows";

const COMFY_URL = process.env.COMFY_URL ?? process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188";

export interface ImagePresetAvailability {
  available: boolean;
  missing: string[];
  missingNodes: string[];
}

export interface ImageModelAvailability {
  online: boolean;
  presets: Record<string, ImagePresetAvailability>;
}

interface ObjectInfoNode {
  input?: {
    required?: Record<string, unknown>;
  };
}

type ObjectInfo = Record<string, ObjectInfoNode>;

interface ExpectedModel {
  node: string;
  input: string;
  filename: string;
}

interface PresetDefinition {
  nodes: string[];
  models: ExpectedModel[];
}

const PRESET_DEFINITIONS: Record<string, PresetDefinition> = {
  "sdxl-turbo": {
    nodes: ["CheckpointLoaderSimple", "EmptyLatentImage", "CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
    models: [
      { node: "CheckpointLoaderSimple", input: "ckpt_name", filename: SDXL_TURBO_CHECKPOINT },
    ],
  },
  "sdxl-t2i": {
    nodes: ["CheckpointLoaderSimple", "EmptyLatentImage", "CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
    models: [
      { node: "CheckpointLoaderSimple", input: "ckpt_name", filename: SDXL_BASE_CHECKPOINT },
    ],
  },
  "flux-gguf": {
    nodes: ["DualCLIPLoaderGGUF", "UnetLoaderGGUF", "VAELoader", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage"],
    models: [
      { node: "DualCLIPLoaderGGUF", input: "clip_name1", filename: FLUX_GGUF_CLIP_L },
      { node: "DualCLIPLoaderGGUF", input: "clip_name2", filename: FLUX_GGUF_T5XXL },
      { node: "UnetLoaderGGUF", input: "unet_name", filename: FLUX_GGUF_UNET },
      { node: "VAELoader", input: "vae_name", filename: FLUX_GGUF_VAE },
    ],
  },
  "flux-nunchaku": {
    nodes: ["NunchakuTextEncoderLoaderV2", "NunchakuFluxDiTLoader", "VAELoader", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage"],
    models: [
      { node: "NunchakuTextEncoderLoaderV2", input: "clip_l", filename: FLUX_GGUF_CLIP_L },
      { node: "NunchakuTextEncoderLoaderV2", input: "t5xxl", filename: FLUX_GGUF_T5XXL },
      { node: "NunchakuFluxDiTLoader", input: "model", filename: FLUX_NUNCHAKU_MODEL },
      { node: "VAELoader", input: "vae_name", filename: FLUX_GGUF_VAE },
    ],
  },
  "qwen-edit": {
    nodes: ["UnetLoaderGGUF", "CLIPLoader", "VAELoader", "LoadImage", "TextEncodeQwenImageEditPlus", "ModelSamplingAuraFlow", "VAEEncode", "KSampler", "VAEDecode", "SaveImage"],
    models: [
      { node: "UnetLoaderGGUF", input: "unet_name", filename: QWEN_EDIT_UNET },
      { node: "CLIPLoader", input: "clip_name", filename: QWEN_EDIT_CLIP },
      { node: "VAELoader", input: "vae_name", filename: QWEN_EDIT_VAE },
    ],
  },
  "flux2-klein": {
    nodes: ["UnetLoaderGGUF", "CLIPLoader", "VAELoader", "CLIPTextEncode", "ConditioningZeroOut", "EmptyFlux2LatentImage", "VAEEncode", "Flux2Scheduler", "SamplerCustomAdvanced", "KSamplerSelect", "BasicGuider", "RandomNoise", "VAEDecode", "SaveImage"],
    models: [
      { node: "UnetLoaderGGUF", input: "unet_name", filename: FLUX2_KLEIN_UNET },
      { node: "CLIPLoader", input: "clip_name", filename: FLUX2_KLEIN_CLIP },
      { node: "VAELoader", input: "vae_name", filename: FLUX2_KLEIN_VAE },
    ],
  },
  "z-image-turbo": {
    nodes: ["UNETLoader", "CLIPLoader", "VAELoader", "CLIPTextEncode", "ConditioningZeroOut", "EmptySD3LatentImage", "ModelSamplingAuraFlow", "KSampler", "VAEDecode", "SaveImage"],
    models: [
      { node: "UNETLoader", input: "unet_name", filename: Z_IMAGE_UNET },
      { node: "CLIPLoader", input: "clip_name", filename: Z_IMAGE_CLIP },
      { node: "VAELoader", input: "vae_name", filename: Z_IMAGE_VAE },
    ],
  },
  upscale: {
    nodes: ["LoadImage", "UpscaleModelLoader", "ImageUpscaleWithModel", "SaveImage"],
    models: [
      { node: "UpscaleModelLoader", input: "model_name", filename: UPSCALE_MODEL },
    ],
  },
};

export async function getImageModelAvailability(): Promise<ImageModelAvailability> {
  const objectInfo = await fetchObjectInfo();
  if (!objectInfo) {
    return { online: false, presets: {} };
  }

  const presets = Object.fromEntries(
    Object.entries(PRESET_DEFINITIONS).map(([preset, definition]) => {
      const missingNodes = definition.nodes.filter((node) => !objectInfo[node]);
      const missing = unique(definition.models.flatMap((model) => {
        if (!objectInfo[model.node]) return [];
        const options = loaderEnumValues(objectInfo, model.node, model.input);
        return options.includes(model.filename) ? [] : [model.filename];
      }));

      return [preset, {
        available: missing.length === 0 && missingNodes.length === 0,
        missing,
        missingNodes,
      }];
    })
  );

  return { online: true, presets };
}

async function fetchObjectInfo(): Promise<ObjectInfo | null> {
  try {
    const res = await fetch(`${COMFY_URL}/object_info`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return (await res.json()) as ObjectInfo;
  } catch {
    return null;
  }
}

function loaderEnumValues(objectInfo: ObjectInfo, node: string, inputName: string): string[] {
  const input = objectInfo[node]?.input?.required?.[inputName];
  if (!Array.isArray(input)) return [];

  const [kind, options] = input;
  if (Array.isArray(kind)) {
    return kind.filter((value): value is string => typeof value === "string");
  }

  if (kind === "COMBO" && isRecord(options) && Array.isArray(options.options)) {
    return options.options.filter((value): value is string => typeof value === "string");
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
