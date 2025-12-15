/**
 * Workflow Loader - Builds ComfyUI API workflows from templates
 * 
 * ComfyUI API format is different from the web UI format.
 * API format: { "node_id": { class_type, inputs } }
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
    case "qwen-edit":
      return buildQwenEditWorkflow(params);
    case "hunyuan-3d":
      return buildHunyuan3DWorkflow(params);
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
  const width = params.width ?? 768;
  const height = params.height ?? 768;
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
// Qwen Image Edit
// ============================================================================

function buildQwenEditWorkflow(params: WorkflowParams): Record<string, unknown> {
  const seed = params.seed ?? Math.floor(Math.random() * 1000000000);
  const instruction = params.instruction ?? "enhance the image";
  const imageFilename = params.image_filename;

  if (!imageFilename) {
    throw new Error("image_filename is required for qwen-edit workflow");
  }

  return {
    // Load the input image from ComfyUI input folder
    "1": {
      class_type: "LoadImage",
      inputs: {
        image: imageFilename,
      },
    },
    // Load VAE
    "39": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "qwen_image_vae.safetensors",
      },
    },
    // Load CLIP (Qwen Image)
    "38": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
        type: "qwen_image",
        device: "default",
      },
    },
    // Load UNET
    "37": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "qwen_image_edit_2509_fp8_e4m3fn.safetensors",
        weight_dtype: "fp8_e4m3fn",
      },
    },
    // Load LoRA for faster inference
    "89": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["37", 0],
        lora_name: "Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors",
        strength_model: 1,
      },
    },
    // Model sampling
    "66": {
      class_type: "ModelSamplingAuraFlow",
      inputs: {
        model: ["89", 0],
        shift: 6,
      },
    },
    // CFG normalization
    "75": {
      class_type: "CFGNorm",
      inputs: {
        model: ["66", 0],
        strength: 1,
      },
    },
    // Encode the input image
    "88": {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["1", 0],
        vae: ["39", 0],
      },
    },
    // Encode the edit instruction with image context
    "110": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["38", 0],
        prompt: instruction,
        vae: ["39", 0],
        image1: ["1", 0],
      },
    },
    // Empty conditioning for negative
    "111": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        clip: ["38", 0],
        prompt: "",
        vae: ["39", 0],
        image1: ["1", 0],
      },
    },
    // Empty latent for output size matching input
    "112": {
      class_type: "EmptySD3LatentImage",
      inputs: {
        width: 1024,
        height: 1024,
        batch_size: 1,
      },
    },
    // KSampler
    "3": {
      class_type: "KSampler",
      inputs: {
        model: ["75", 0],
        positive: ["110", 0],
        negative: ["111", 0],
        latent_image: ["88", 0],
        seed: seed,
        steps: 4, // Lightning LoRA uses 4 steps
        cfg: 2.5,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 0.8,
      },
    },
    // Decode
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["39", 0],
      },
    },
    // Save
    "60": {
      class_type: "SaveImage",
      inputs: {
        images: ["8", 0],
        filename_prefix: "deck_edit",
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
