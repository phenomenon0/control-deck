/**
 * Voice engine catalogue.
 *
 * Single source of truth for:
 *  - which studio engines the Voice Cloning Studio knows about,
 *  - which engines are actually runnable in this build,
 *  - default-ordering for the "recommended engine" fallback.
 *
 * The assistant surface reuses the existing inference registry directly
 * (lib/inference/registry + lib/inference/runtime) — that registry already
 * holds TTS/STT providers with modality metadata and live model lists. The
 * studio/library surfaces additionally need an engine-family axis (e.g.
 * "elevenlabs-pvc" vs "elevenlabs" for standard TTS), so this module layers
 * that on without duplicating the provider list.
 *
 * 2026-04 SOTA refresh:
 *   - Dropped paper-only engines (qwen3-tts, gpt-sovits) that had no executor.
 *   - Added Inworld TTS-1.5 clone (#1 on Artificial Analysis ELO, free zero-shot).
 *   - Added Cartesia IVC (3s reference, fastest instant clone).
 *   - Added Hume Octave (voice design from text description — unique in 2026).
 *   - Added ElevenLabs IVC alongside PVC so short-reference users have a path.
 *   - Left local OSS heavy-hitters (f5-tts, orpheus, cosyvoice-3, kokoro) in
 *     the catalogue as roadmap entries; implemented flips when the voice-api
 *     sidecar gains support for them.
 */

import type { VoiceEngineDescriptor } from "./types";

/** Studio engines — ranked by 2026-04 SOTA snapshot. */
export const STUDIO_ENGINES: VoiceEngineDescriptor[] = [
  // ─── Cloud clone (runnable today) ───────────────────────────────────────
  {
    id: "elevenlabs-pvc",
    name: "ElevenLabs — Professional Voice Clone",
    providerId: "elevenlabs",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "multilingual", "streaming", "cloud", "expressive"],
    description:
      "Fine-tuned clone with studio-grade similarity. Needs 30+ minutes of clean reference audio.",
    tier: "gold",
    minReferenceMinutes: 30,
    implemented: true,
  },
  {
    id: "elevenlabs-ivc",
    name: "ElevenLabs — Instant Voice Clone",
    providerId: "elevenlabs",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "multilingual", "streaming", "cloud"],
    description:
      "Zero-shot clone from 1–2 min of reference. Pairs with eleven_v3 or eleven_flash_v2_5.",
    tier: "gold",
    minReferenceMinutes: 1,
    implemented: true,
  },
  {
    id: "cartesia-ivc",
    name: "Cartesia — Instant Voice Clone (Sonic-3)",
    providerId: "cartesia",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "multilingual", "streaming", "cloud"],
    description:
      "3-second reference minimum. ~40–90ms TTFB — best fit for real-time agents.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: true,
  },
  {
    id: "inworld-tts-clone",
    name: "Inworld TTS-1.5 — Instant Clone",
    providerId: "inworld",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "streaming", "cloud"],
    description:
      "#1 on Artificial Analysis ELO (Mar 2026). 5–15s reference, free cloning.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: true,
  },
  // ─── Cloud voice design (not clone — generate a voice from a prompt) ────
  {
    id: "hume-octave",
    name: "Hume Octave 2 — Voice Design",
    providerId: "hume",
    modalities: ["tts"],
    capabilities: ["design", "tts", "streaming", "cloud", "expressive"],
    description:
      "Generate a voice from a natural-language description (\"warm, slow Southern grandmother\").",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: true,
  },
  // ─── Cloud expressive TTS leaders (Artificial Analysis Mar 2026) ────────
  {
    id: "gemini-tts",
    name: "Gemini 3.1 Flash — Native TTS",
    providerId: "google",
    modalities: ["tts"],
    capabilities: ["tts", "multilingual", "streaming", "cloud", "expressive"],
    description:
      "Artificial Analysis ELO 1211 (Mar 2026) — beats ElevenLabs v3, ~15× cheaper. 24 languages.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: true,
  },
  // ─── Local via voice-api sidecar (runnable today) ───────────────────────
  {
    id: "xtts-v2",
    name: "XTTS v2",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "multilingual", "local"],
    description: "Legacy Coqui XTTS-v2 via the local voice-api sidecar.",
    tier: "silver",
    minReferenceMinutes: 0,
    implemented: true,
  },
  {
    id: "chatterbox",
    name: "Chatterbox",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["tts", "local", "expressive"],
    description: "Resemble Chatterbox on the local voice-api. Emotion-exaggeration scalar.",
    tier: "silver",
    minReferenceMinutes: 0,
    implemented: true,
  },
  // ─── Local roadmap (catalogued; sidecar support pending) ────────────────
  {
    id: "chatterbox-turbo",
    name: "Chatterbox Turbo",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["tts", "local", "streaming", "expressive"],
    description: "6× real-time diffusion variant with paralinguistic tags. Sidecar support pending.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: false,
  },
  {
    id: "f5-tts",
    name: "F5-TTS v1",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "local"],
    description: "MIT flow-matching non-AR TTS. RTF ~0.15 on RTX 4090. Sidecar support pending.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: false,
  },
  {
    id: "orpheus",
    name: "Orpheus 3B (Canopy Labs)",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "local", "streaming", "expressive"],
    description: "Apache 2.0. Best OSS paralinguistic tags ([laugh], [sigh]). Lazy-loads ~6GB VRAM on first request.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: true,
  },
  {
    id: "cosyvoice-3",
    name: "CosyVoice 3",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "multilingual", "local", "streaming"],
    description: "Apache 2.0. 9 languages, 150ms first-packet. Sidecar support pending.",
    tier: "silver",
    minReferenceMinutes: 0,
    implemented: false,
  },
  {
    id: "kokoro",
    name: "Kokoro 82M",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["tts", "local", "streaming"],
    description: "Apache 2.0, 82M ONNX. 50+ voices, ~200ms first chunk on GPU, very natural for size.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: true,
  },
  {
    id: "fish-speech-s2",
    name: "Fish Speech S2",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "multilingual", "streaming", "local", "expressive"],
    description: "Best short-clip clone similarity (3–10s). Sidecar support pending.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: false,
    licenseNote: "Non-commercial research license — paid tier required for commercial use.",
  },
  {
    id: "qwen3-tts",
    name: "Qwen3-TTS (Alibaba)",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["tts", "multilingual", "local", "streaming", "expressive"],
    description:
      "Apache 2.0. 10 languages, 97ms TTFA, 1.835% WER — OSS frontier. Sidecar support pending.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: false,
  },
  {
    id: "indextts-2",
    name: "IndexTTS 2 (Bilibili)",
    providerId: "voice-api",
    modalities: ["tts"],
    capabilities: ["clone", "tts", "multilingual", "local", "expressive"],
    description:
      "Best CN/EN WER on recent benchmarks (Mar 2026). 20k★. Sidecar support pending.",
    tier: "gold",
    minReferenceMinutes: 0,
    implemented: false,
    licenseNote:
      "Non-commercial weight license — legal review required before production use.",
  },
];

/** Assistant defaults — promoted when we auto-pick a provider for a new session. */
export interface AssistantDefaults {
  sttPrimary: { providerId: string; model: string };
  sttAdvanced: { providerId: string; model: string };
  sttAccuracy: { providerId: string; model: string };
  ttsFast: { providerId: string; model: string };
  ttsQuality: { providerId: string; model: string };
  ttsExpressive: { providerId: string; model: string };
  offlineFallback: { providerId: string; engine?: string };
}

export const ASSISTANT_DEFAULTS: AssistantDefaults = {
  // Cheap + fast batch: Groq whisper-large-v3-turbo at $0.04/hr.
  sttPrimary: { providerId: "groq", model: "whisper-large-v3-turbo" },
  // Streaming low-latency agent tier: Cartesia Ink-Whisper (~sub-300ms first-partial).
  sttAdvanced: { providerId: "cartesia", model: "ink-whisper" },
  // Accuracy ceiling: AssemblyAI Universal-3 Pro — 1.52% WER LibriSpeech (Mar 2026).
  sttAccuracy: { providerId: "assemblyai", model: "universal-3-pro" },
  // Fast agent TTS: Cartesia Sonic-3 (~40-90ms TTFB).
  ttsFast: { providerId: "cartesia", model: "sonic-3" },
  // Quality tier: Gemini 3.1 Flash TTS — Artificial Analysis ELO #1 (Mar 2026).
  ttsQuality: { providerId: "google", model: "gemini-3.1-flash-preview-tts" },
  // Expressive / voice-design tier: Hume Octave 2.
  ttsExpressive: { providerId: "hume", model: "octave-2" },
  offlineFallback: { providerId: "voice-api", engine: "piper" },
};

export function getStudioEngine(id: string): VoiceEngineDescriptor | undefined {
  return STUDIO_ENGINES.find((e) => e.id === id);
}

export function listStudioEngines(
  opts: { implementedOnly?: boolean } = {},
): VoiceEngineDescriptor[] {
  if (opts.implementedOnly) return STUDIO_ENGINES.filter((e) => e.implemented);
  return STUDIO_ENGINES;
}
