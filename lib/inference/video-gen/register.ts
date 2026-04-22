/**
 * Video-generation providers.
 *
 * Today: nothing. ComfyUI has HunyuanVideo / CogVideoX / LTXV nodes but
 * Control Deck ships no video-gen tool or workflow. This modality is fully
 * greenfield.
 *
 * Planned registrations:
 *   comfyui   — once a video workflow is added under lib/tools/workflows/
 *   runway    — Gen-3 Alpha / Turbo; premium quality
 *   pika      — Pika 2.0; lower cost
 *   luma      — Dream Machine; strong image-to-video
 *   stability — Stable Video Diffusion API
 *   replicate — aggregator for open video models (CogVideoX, LTXV, etc.)
 *   fal       — aggregator alternative
 */

export function registerVideoGenProviders(): void {
  // no-op for step 1
}
