/**
 * Image-generation providers.
 *
 * Today: lib/tools/comfy.ts is the sole image-gen client. ComfyUI drives
 * SDXL Turbo / SDXL / FLUX (GGUF + Nunchaku) / Qwen-Edit workflows defined
 * in lib/tools/workflows/index.ts. The ONNX Lite pipeline in
 * lib/tools/lite-image/pipeline.ts is a CPU-only fallback.
 *
 * Planned registrations:
 *   comfyui    — wraps lib/tools/comfy.ts; workflow selection via config.extras
 *   lite-onnx  — wraps lib/tools/lite-image; always-available CPU fallback
 *   replicate  — aggregator, unlocks 50+ image models via one API key
 *   fal        — aggregator, alternate; tends to be faster than Replicate
 *   stability  — direct API for SD3 / SDXL
 *   openai     — DALL-E 3 via images.generate
 *   bfl        — Black Forest Labs FLUX.1 pro/ultra direct
 */

export function registerImageGenProviders(): void {
  // no-op for step 1
}
