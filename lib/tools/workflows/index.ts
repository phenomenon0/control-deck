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
  
  // Image input - filename in ComfyUI input folder (not base64)
  image_filename?: string;
  instruction?: string;
  
  // FLUX/Black0S specific
  lora_name?: string;
  lora_strength?: number;
  controlnet_strength?: number;
  upscale?: boolean;
}

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
    case "hunyuan-3d":
      return buildHunyuan3DWorkflow(params);
    // Black0S FLUX-based workflows
    case "flux-gguf":
      return buildFluxGGUFWorkflow(params);
    case "flux-nunchaku":
      return buildFluxNunchakuWorkflow(params);
    case "sdxl-sd":
      return buildSDXLSDWorkflow(params);
    default:
      throw new Error(`Unknown workflow preset: ${preset}`);
  }
}

// ============================================================================
// Stable Audio - Text to Audio
// ============================================================================

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

// ============================================================================
// SDXL Turbo - Fast Text to Image (4 steps)
// ============================================================================

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
        ckpt_name: "sd_xl_turbo_1.0_fp16.safetensors",
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
        sampler_name: "euler_ancestral",
        scheduler: "normal",
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

// ============================================================================
// SDXL - Text to Image
// ============================================================================

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
        ckpt_name: "sd_xl_base_1.0.safetensors",
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
        sampler_name: "euler",
        scheduler: "normal",
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

// ============================================================================
// Hunyuan 3D - Image to 3D Model
// ============================================================================

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

// ============================================================================
// FLUX GGUF - Text to Image (Q8 quantized FLUX)
// Based on Black0S workflow - requires ~10-12GB VRAM
// Models: flux1-dev-Q8_0.gguf, clip_l.safetensors, t5xxl_fp16.safetensors
// ============================================================================

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
        clip_name1: "FLUX/clip_l.safetensors",
        clip_name2: "FLUX/t5xxl_fp16.safetensors",
        type: "flux",
      },
    },
    // Load FLUX UNET (GGUF quantized)
    "2": {
      class_type: "UnetLoaderGGUF",
      inputs: {
        unet_name: "FLUX/flux1-dev-Q8_0.gguf",
      },
    },
    // Load VAE
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "FLUX/diffusion_pytorch_model.safetensors",
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
        sampler_name: "euler",
        scheduler: "simple",
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

// ============================================================================
// FLUX Nunchaku - Text to Image (INT4 quantized FLUX - very fast!)
// Based on Black0S workflow - requires only ~6-8GB VRAM
// Models: svdq-int4_r32-flux.1-dev.safetensors (Nunchaku quantized)
// ============================================================================

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
        clip_l: "FLUX/clip_l.safetensors",
        t5xxl: "FLUX/t5xxl_fp16.safetensors",
        max_token_length: 512,
      },
    },
    // Load FLUX DiT with Nunchaku INT4 quantization
    "2": {
      class_type: "NunchakuFluxDiTLoader",
      inputs: {
        model: "NUNCHAKU/svdq-int4_r32-flux.1-dev.safetensors",
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
        vae_name: "FLUX/diffusion_pytorch_model.safetensors",
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
        sampler_name: "euler",
        scheduler: "simple",
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

// ============================================================================
// SDXL/SD Hybrid - Text to Image
// Based on Black0S workflow - supports SDXL, Pony, Illustrious, SD models
// Requires ~8-10GB VRAM
// ============================================================================

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
        ckpt_name: "sd_xl_base_1.0.safetensors", // Default, can be swapped
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
