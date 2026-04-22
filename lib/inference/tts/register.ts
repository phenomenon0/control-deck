/**
 * Text-to-speech providers.
 *
 * Today: app/api/voice/tts/route.ts proxies to VOICE_API_URL (port 8000)
 * with three engine options: piper (default) / xtts / chatterbox. Engine
 * choice lives in components/settings/DeckSettingsProvider.tsx:14.
 *
 * Planned registrations:
 *   voice-api   — wraps the existing VOICE_API_URL sidecar, engines remain
 *                 as config.extras.engine="piper"|"xtts"|"chatterbox"
 *   elevenlabs  — direct API; quality ceiling, per-voice models
 *   openai      — tts-1 / tts-1-hd, 6 canonical voices
 *   cartesia    — Sonic, low-latency streaming
 *   kokoro      — open-weight, self-hostable
 *   deepgram    — Aura voices
 */

export function registerTtsProviders(): void {
  // no-op for step 1
}
