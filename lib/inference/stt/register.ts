/**
 * Speech-to-text providers.
 *
 * Today: app/api/voice/stt/route.ts proxies to VOICE_API_URL (port 8000).
 * The underlying engine is assumed to be Whisper via the Voice API sidecar;
 * no direct cloud STT integration yet.
 *
 * Planned registrations:
 *   voice-api   — wraps existing VOICE_API_URL sidecar
 *   openai      — whisper-1 API
 *   groq        — hosts whisper-large-v3 at very low latency + free tier
 *   deepgram    — Nova-2 / Nova-3; strong for live captioning
 *   assemblyai  — strong diarization
 *   local-whisper — whisper.cpp direct, no sidecar
 */

export function registerSttProviders(): void {
  // no-op for step 1
}
