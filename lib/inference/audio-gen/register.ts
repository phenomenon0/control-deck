/**
 * Audio-generation providers (music, SFX, not voice — see tts/ for speech).
 *
 * Today: ComfyUI Stable Audio + ACE Step workflows in
 * lib/tools/workflows/index.ts. Also reused via `live.generate_sample` to
 * drop a generated clip into the Live DAW track.
 *
 * Planned registrations:
 *   comfyui    — wraps lib/tools/comfy.ts with stable-audio + ace-step presets
 *   suno       — commercial music generation
 *   udio       — commercial music generation
 *   elevenlabs — SFX endpoint (not its TTS endpoint)
 *   replicate  — aggregator; covers audiogen, musicgen, etc.
 */

export function registerAudioGenProviders(): void {
  // no-op for step 1
}
