/**
 * Workflow Loader - Builds ComfyUI API workflows from templates
 * 
 * ComfyUI API format is different from the web UI format.
 * API format: { "node_id": { class_type, inputs } }
 * 
 * Black0S Workflows (FLUX-based):
 * - flux-gguf: FLUX with GGUF quantization (~8-12GB VRAM)
 * - flux-nunchaku: FLUX with Nunchaku int4 quantization (~6-8GB VRAM) 
 * - sdxl-sd: SDXL/SD hybrid workflow (~8-10GB VRAM)
 */

export interface WorkflowParams {
  // Common
  seed?: number;
  
  // Audio
  prompt?: string;
  negative_prompt?: string;
  duration?: number;
  
  // Image
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  shift?: number;
  
  // Image input - filename in ComfyUI input folder (not base64)
  image_filename?: string;
  instruction?: string;
  upscale_model?: string;
  
  // FLUX/Black0S specific
  lora_name?: string;
  lora_strength?: number;
  controlnet_strength?: number;
  upscale?: boolean;
}

export const SDXL_TURBO_CHECKPOINT = "sd_xl_turbo_1.0_fp16.safetensors";
export const SDXL_BASE_CHECKPOINT = "sd_xl_base_1.0.safetensors";
export const FLUX_GGUF_CLIP_L = "FLUX/clip_l.safetensors";
export const FLUX_GGUF_T5XXL = "FLUX/t5xxl_fp16.safetensors";
export const FLUX_GGUF_UNET = "FLUX/flux1-dev-Q8_0.gguf";
export const FLUX_GGUF_VAE = "FLUX/diffusion_pytorch_model.safetensors";
export const FLUX_NUNCHAKU_MODEL = "NUNCHAKU/svdq-int4_r32-flux.1-dev.safetensors";
export const QWEN_EDIT_UNET = process.env.QWEN_EDIT_UNET ?? "qwen-image-edit-2511-Q4_K_M.gguf";
export const QWEN_EDIT_CLIP = process.env.QWEN_EDIT_CLIP ?? "qwen_2.5_vl_7b_fp8_scaled.safetensors";
export const QWEN_EDIT_VAE = process.env.QWEN_EDIT_VAE ?? "qwen_image_vae.safetensors";
export const FLUX2_KLEIN_UNET = process.env.FLUX2_KLEIN_UNET ?? "flux-2-klein-4b-Q8_0.gguf";
export const FLUX2_KLEIN_CLIP = process.env.FLUX2_KLEIN_CLIP ?? "qwen_3_4b.safetensors";
export const FLUX2_KLEIN_VAE = process.env.FLUX2_KLEIN_VAE ?? "flux2-vae.safetensors";
export const UPSCALE_MODEL = process.env.UPSCALE_MODEL ?? "RealESRGAN_x4plus.pth";
export const Z_IMAGE_UNET = process.env.Z_IMAGE_UNET ?? "z_image_turbo_bf16.safetensors";
export const Z_IMAGE_CLIP = process.env.Z_IMAGE_CLIP ?? "qwen_3_4b.safetensors";
export const Z_IMAGE_VAE = process.env.Z_IMAGE_VAE ?? "ae.safetensors";

/**
 * Load and parameterize a workflow
 */
export function loadWorkflow(
  preset: string,
  params: WorkflowParams
): Record<string, unknown> {
  switch (preset) {
    case "stable-audio":
      return buildStableAudioWorkflow(params);
    case "sdxl-t2i":
      return buildSDXLWorkflow(params);
    case "sdxl-turbo":
      return buildSDXLTurboWorkflow(params);
    case "qwen-edit":
      return buildQwenEditWorkflow(params);
    case "flux2-klein":
      return buildFlux2KleinWorkflow(params);
    case "z-image-turbo":
      return buildZImageTurboWorkflow(params);
    case "upscale":
      return buildUpscaleWorkflow(params);
    case "hunyuan-3d":
      return buildHunyuan3DWorkflow(params);
    // Black0S FLUX-based workflows
    case "flux-gguf":
      return buildFluxGGUFWorkflow(params);
    case "flux-nunchaku":
      return buildFluxNunchakuWorkflow(params);
    case "sdxl-sd":
      return buildSDXLSDWorkflow(params);
    case "ace-step":
      return buildAceStepWorkflow(params);
    default:
      throw new Error(`Unknown workflow preset: ${preset}`);
  }
}

function buildAceStepWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const duration = params.duration ?? 15;
  const prompt = params.prompt ?? "upbeat electronic music";

  return {
    "1": {
      class_type: "ACEStepModelLoader",
      inputs: {
        model: "ace-step-v1.5.safetensors",
      },
    },
    "2": {
      class_type: "ACEStepSampler",
      inputs: {
        model: ["1", 0],
        prompt: prompt,
        duration: duration,
        seed: seed,
        steps: 100,
        cfg: 7,
      },
    },
    "3": {
      class_type: "SaveAudioMP3",
      inputs: {
        audio: ["2", 0],
        filename_prefix: "deck_ace_step",
        quality: "V0",
      },
    },
  };
}

function buildStableAudioWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const duration = params.duration ?? 10;
  const prompt = params.prompt ?? "ambient music";

  return {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "stable-audio-open-1.0.safetensors",
      },
    },
    "10": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "t5-base.safetensors",
        type: "stable_audio",
        device: "default",
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["10", 0],
        text: prompt,
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["10", 0],
        text: params.negative_prompt ?? "",
      },
    },
    "11": {
      class_type: "EmptyLatentAudio",
      inputs: {
        seconds: duration,
        batch_size: 1,
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["11", 0],
        seed: seed,
        steps: 50,
        cfg: 4.98,
        sampler_name: "dpmpp_3m_sde_gpu",
        scheduler: "exponential",
        denoise: 1,
      },
    },
    "12": {
      class_type: "VAEDecodeAudio",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "19": {
      class_type: "SaveAudioMP3",
      inputs: {
        audio: ["12", 0],
        filename_prefix: "deck_audio",
        quality: "V0",
      },
    },
  };
}

function buildSDXLTurboWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const width = params.width ?? 512;
  const height = params.height ?? 512;
  const steps = params.steps ?? 4; // Turbo uses 1-4 steps
  const cfg = 1.0; // Turbo requires low CFG (1.0-2.0)
  const prompt = params.prompt ?? "a beautiful landscape";

  return {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: SDXL_TURBO_CHECKPOINT,
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["4", 1],
        text: prompt,
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["4", 1],
        text: "", // Turbo works best with empty negative
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
        seed: seed,
        steps: steps,
        cfg: cfg,
        sampler_name: params.sampler ?? "euler_ancestral",
        scheduler: params.scheduler ?? "normal",
        denoise: 1,
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        images: ["8", 0],
        filename_prefix: "deck_turbo",
      },
    },
  };
}

function buildSDXLWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const width = params.width ?? 1024;
  const height = params.height ?? 1024;
  const steps = params.steps ?? 20;
  const cfg = params.cfg ?? 7;
  const prompt = params.prompt ?? "a beautiful landscape";
  const negativePrompt = params.negative_prompt ?? "blurry, low quality, distorted, deformed";

  return {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: SDXL_BASE_CHECKPOINT,
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["4", 1],
        text: prompt,
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["4", 1],
        text: negativePrompt,
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
        seed: seed,
        steps: steps,
        cfg: cfg,
        sampler_name: params.sampler ?? "euler",
        scheduler: params.scheduler ?? "normal",
        denoise: 1,
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        images: ["8", 0],
        filename_prefix: "deck_img",
      },
    },
  };
}

function buildQwenEditWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const imageFilename = params.image_filename;
  const instruction = params.instruction ?? "";

  if (!imageFilename) {
    throw new Error("image_filename is required for qwen-edit workflow");
  }

  return {
    "1": {
      class_type: "UnetLoaderGGUF",
      inputs: {
        unet_name: QWEN_EDIT_UNET,
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: QWEN_EDIT_CLIP,
        type: "qwen_image",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: QWEN_EDIT_VAE,
      },
    },
    "4": {
      class_type: "LoadImage",
      inputs: {
        image: imageFilename,
      },
    },
    "5": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["2", 0],
        prompt: instruction,
        vae: ["3", 0],
        image1: ["4", 0],
      },
    },
    "6": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["2", 0],
        prompt: "",
        vae: ["3", 0],
        image1: ["4", 0],
      },
    },
    "7": {
      class_type: "ModelSamplingAuraFlow",
      inputs: {
        model: ["1", 0],
        shift: params.shift ?? 3.1,
      },
    },
    "8": {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["4", 0],
        vae: ["3", 0],
      },
    },
    "9": {
      class_type: "KSampler",
      inputs: {
        model: ["7", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["8", 0],
        seed: seed,
        steps: 20,
        cfg: 2.5,
        sampler_name: params.sampler ?? "euler",
        scheduler: params.scheduler ?? "simple",
        denoise: 1.0,
      },
    },
    "10": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["9", 0],
        vae: ["3", 0],
      },
    },
    "11": {
      class_type: "SaveImage",
      inputs: {
        images: ["10", 0],
        filename_prefix: "deck_qwen_edit",
      },
    },
  };
}

function buildFlux2KleinWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const width = params.width ?? 1024;
  const height = params.height ?? 1024;
  const steps = params.steps ?? 20;
  const prompt = params.prompt ?? "a beautiful landscape";
  const imageFilename = params.image_filename;
  const latentRef: [string, number] = imageFilename ? ["7", 0] : ["6", 0];

  const workflow: Record<string, unknown> = {
    "1": {
      class_type: "UnetLoaderGGUF",
      inputs: {
        unet_name: FLUX2_KLEIN_UNET,
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: FLUX2_KLEIN_CLIP,
        type: "flux2",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: FLUX2_KLEIN_VAE,
      },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 0],
        text: prompt,
      },
    },
    "5": {
      class_type: "ConditioningZeroOut",
      inputs: {
        conditioning: ["4", 0],
      },
    },
    "6": {
      class_type: "EmptyFlux2LatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    "8": {
      class_type: "KSamplerSelect",
      inputs: {
        sampler_name: params.sampler ?? "euler",
      },
    },
    "9": {
      class_type: "Flux2Scheduler",
      inputs: {
        steps: steps,
        width: width,
        height: height,
      },
    },
    "10": {
      class_type: "BasicGuider",
      inputs: {
        model: ["1", 0],
        conditioning: ["4", 0],
      },
    },
    "11": {
      class_type: "RandomNoise",
      inputs: {
        noise_seed: seed,
      },
    },
    "12": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["11", 0],
        guider: ["10", 0],
        sampler: ["8", 0],
        sigmas: ["9", 0],
        latent_image: latentRef,
      },
    },
    "13": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["12", 0],
        vae: ["3", 0],
      },
    },
    "14": {
      class_type: "SaveImage",
      inputs: {
        images: ["13", 0],
        filename_prefix: "deck_flux2",
      },
    },
  };

  if (imageFilename) {
    workflow["6"] = {
      class_type: "LoadImage",
      inputs: {
        image: imageFilename,
      },
    };
    workflow["7"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["6", 0],
        vae: ["3", 0],
      },
    };
  }

  return workflow;
}

// Mirrors ComfyUI's official image_z_image_turbo template: UNETLoader +
// CLIPLoader(type lumina2) + EmptySD3LatentImage, 9-step res_multistep cfg 1.
function buildZImageTurboWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const width = params.width ?? 1024;
  const height = params.height ?? 1024;
  const steps = params.steps ?? 9;
  const prompt = params.prompt ?? "a beautiful landscape";

  return {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: Z_IMAGE_UNET,
        weight_dtype: "default",
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: Z_IMAGE_CLIP,
        type: "lumina2",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: Z_IMAGE_VAE,
      },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 0],
        text: prompt,
      },
    },
    "5": {
      class_type: "ConditioningZeroOut",
      inputs: {
        conditioning: ["4", 0],
      },
    },
    "6": {
      class_type: "EmptySD3LatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    "7": {
      class_type: "ModelSamplingAuraFlow",
      inputs: {
        model: ["1", 0],
        shift: params.shift ?? 3,
      },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["7", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed: seed,
        steps: steps,
        cfg: params.cfg ?? 1,
        sampler_name: params.sampler ?? "res_multistep",
        scheduler: params.scheduler ?? "simple",
        denoise: 1.0,
      },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["8", 0],
        vae: ["3", 0],
      },
    },
    "10": {
      class_type: "SaveImage",
      inputs: {
        images: ["9", 0],
        filename_prefix: "deck_zimage",
      },
    },
  };
}

function buildUpscaleWorkflow(params: WorkflowParams): Record<string, unknown> {
  const imageFilename = params.image_filename;
  const upscaleModel = params.upscale_model ?? UPSCALE_MODEL;

  if (!imageFilename) {
    throw new Error("image_filename is required for upscale workflow");
  }

  return {
    "1": {
      class_type: "LoadImage",
      inputs: {
        image: imageFilename,
      },
    },
    "2": {
      class_type: "UpscaleModelLoader",
      inputs: {
        model_name: upscaleModel,
      },
    },
    "3": {
      class_type: "ImageUpscaleWithModel",
      inputs: {
        upscale_model: ["2", 0],
        image: ["1", 0],
      },
    },
    "4": {
      class_type: "SaveImage",
      inputs: {
        images: ["3", 0],
        filename_prefix: "deck_upscale",
      },
    },
  };
}

function buildHunyuan3DWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const imageFilename = params.image_filename;

  if (!imageFilename) {
    throw new Error("image_filename is required for hunyuan-3d workflow");
  }

  return {
    // Load input image from ComfyUI input folder
    "2": {
      class_type: "LoadImage",
      inputs: {
        image: imageFilename,
      },
    },
    // Load checkpoint (contains MODEL, CLIP_VISION, VAE)
    "1": {
      class_type: "ImageOnlyCheckpointLoader",
      inputs: {
        ckpt_name: "hunyuan_3d_v2.1.safetensors",
      },
    },
    // Model sampling for AuraFlow
    "3": {
      class_type: "ModelSamplingAuraFlow",
      inputs: {
        model: ["1", 0],
        shift: 1,
      },
    },
    // Encode image with CLIP Vision
    "5": {
      class_type: "CLIPVisionEncode",
      inputs: {
        clip_vision: ["1", 1],
        image: ["2", 0],
      },
    },
    // Unclip conditioning
    "6": {
      class_type: "unCLIPConditioning",
      inputs: {
        conditioning: ["8", 0],
        clip_vision_output: ["5", 0],
        strength: 1,
        noise_augmentation: 0,
      },
    },
    // Empty conditioning
    "8": {
      class_type: "ConditioningZeroOut",
      inputs: {
        conditioning: ["9", 0],
      },
    },
    "9": {
      class_type: "ConditioningSetTimestepRange",
      inputs: {
        conditioning: ["10", 0],
        start: 0,
        end: 1,
      },
    },
    "10": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["1", 1], // This might need adjustment for CLIP_VISION
        text: "",
      },
    },
    // Empty latent for multiview generation
    "4": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: 512,
        height: 512,
        batch_size: 6, // 6 views
      },
    },
    // KSampler
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["3", 0],
        positive: ["6", 0],
        negative: ["8", 0],
        latent_image: ["4", 0],
        seed: seed,
        steps: 30,
        cfg: 5,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
      },
    },
    // VAE Decode for multiview images
    "11": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["7", 0],
        vae: ["1", 2],
      },
    },
    // Decode to 3D - this node converts multiview to GLB
    "12": {
      class_type: "VAEDecodeHunyuan3D",
      inputs: {
        samples: ["7", 0],
        vae: ["1", 2],
      },
    },
    // Save GLB
    "13": {
      class_type: "SaveGLB",
      inputs: {
        mesh: ["12", 0],
        filename_prefix: "deck_3d",
      },
    },
  };
}

function buildFluxGGUFWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const width = params.width ?? 1024;
  const height = params.height ?? 1024;
  const steps = params.steps ?? 20;
  const cfg = params.cfg ?? 3.5;
  const prompt = params.prompt ?? "a beautiful landscape";

  return {
    // Load CLIP models (dual encoder for FLUX)
    "1": {
      class_type: "DualCLIPLoaderGGUF",
      inputs: {
        clip_name1: FLUX_GGUF_CLIP_L,
        clip_name2: FLUX_GGUF_T5XXL,
        type: "flux",
      },
    },
    // Load FLUX UNET (GGUF quantized)
    "2": {
      class_type: "UnetLoaderGGUF",
      inputs: {
        unet_name: FLUX_GGUF_UNET,
      },
    },
    // Load VAE
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: FLUX_GGUF_VAE,
      },
    },
    // CLIP Text Encode (positive)
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["1", 0],
        text: prompt,
      },
    },
    // CLIP Text Encode (negative - empty for FLUX)
    "5": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["1", 0],
        text: "",
      },
    },
    // Empty latent
    "6": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    // KSampler
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["2", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed: seed,
        steps: steps,
        cfg: cfg,
        sampler_name: params.sampler ?? "euler",
        scheduler: params.scheduler ?? "simple",
        denoise: 1,
      },
    },
    // VAE Decode
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["7", 0],
        vae: ["3", 0],
      },
    },
    // Save Image
    "9": {
      class_type: "SaveImage",
      inputs: {
        images: ["8", 0],
        filename_prefix: "deck_flux_gguf",
      },
    },
  };
}

function buildFluxNunchakuWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const width = params.width ?? 1024;
  const height = params.height ?? 1024;
  const steps = params.steps ?? 20;
  const cfg = params.cfg ?? 3.5;
  const prompt = params.prompt ?? "a beautiful landscape";
  const loraName = params.lora_name;
  const loraStrength = params.lora_strength ?? 1.0;

  const workflow: Record<string, unknown> = {
    // Load CLIP models with Nunchaku loader
    "1": {
      class_type: "NunchakuTextEncoderLoaderV2",
      inputs: {
        model_type: "flux.1",
        clip_l: FLUX_GGUF_CLIP_L,
        t5xxl: FLUX_GGUF_T5XXL,
        max_token_length: 512,
      },
    },
    // Load FLUX DiT with Nunchaku INT4 quantization
    "2": {
      class_type: "NunchakuFluxDiTLoader",
      inputs: {
        model: FLUX_NUNCHAKU_MODEL,
        cache_threshold: 0,
        attention_mode: "nunchaku-fp16",
        device: "auto",
        offload_threshold: 0,
        dtype: "bfloat16",
        cpu_offload: "enabled",
      },
    },
    // Load VAE
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: FLUX_GGUF_VAE,
      },
    },
    // CLIP Text Encode (positive)
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["1", 0],
        text: prompt,
      },
    },
    // CLIP Text Encode (negative - empty for FLUX)
    "5": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["1", 0],
        text: "",
      },
    },
    // Empty latent
    "6": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    // KSampler
    "7": {
      class_type: "KSampler",
      inputs: {
        model: loraName ? ["10", 0] : ["2", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed: seed,
        steps: steps,
        cfg: cfg,
        sampler_name: params.sampler ?? "euler",
        scheduler: params.scheduler ?? "simple",
        denoise: 1,
      },
    },
    // VAE Decode
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["7", 0],
        vae: ["3", 0],
      },
    },
    // Save Image
    "9": {
      class_type: "SaveImage",
      inputs: {
        images: ["8", 0],
        filename_prefix: "deck_flux_nunchaku",
      },
    },
  };

  // Add LoRA if specified
  if (loraName) {
    workflow["10"] = {
      class_type: "NunchakuFluxLoraLoader",
      inputs: {
        model: ["2", 0],
        lora_name: loraName,
        strength: loraStrength,
      },
    };
  }

  return workflow;
}

function buildSDXLSDWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const width = params.width ?? 1024;
  const height = params.height ?? 1024;
  const steps = params.steps ?? 25;
  const cfg = params.cfg ?? 7;
  const prompt = params.prompt ?? "a beautiful landscape";
  const negativePrompt = params.negative_prompt ?? "blurry, low quality, distorted, deformed, ugly, bad anatomy";

  return {
    // Load Checkpoint (SDXL/Pony/Illustrious)
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: SDXL_BASE_CHECKPOINT, // Default, can be swapped
      },
    },
    // CLIP Text Encode (positive)
    "2": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["1", 1],
        text: prompt,
      },
    },
    // CLIP Text Encode (negative)
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["1", 1],
        text: negativePrompt,
      },
    },
    // Empty latent
    "4": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    // KSampler
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed: seed,
        steps: steps,
        cfg: cfg,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 1,
      },
    },
    // VAE Decode
    "6": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["5", 0],
        vae: ["1", 2],
      },
    },
    // Save Image
    "7": {
      class_type: "SaveImage",
      inputs: {
        images: ["6", 0],
        filename_prefix: "deck_sdxl",
      },
    },
  };
}
