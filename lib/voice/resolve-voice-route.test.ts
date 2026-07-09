import { describe, expect, test } from "bun:test";

import { resolveVoiceRoute } from "./resolve-voice-route";

function avail(id: string, name: string, configured = true, reachable: boolean | null = null) {
  return { id, name, configured, reachable };
}

describe("resolveVoiceRoute", () => {
  test("offline preset has no app-gateway providers", () => {
    const r = resolveVoiceRoute({
      preset: "offline",
      sttProviders: [avail("groq", "Groq", true)],
      ttsProviders: [avail("cartesia", "Cartesia", true)],
    });
    expect(r.stt).toBeNull();
    expect(r.tts).toBeNull();
    expect(r.transport.mode).toBe("app-gateway");
    expect(r.rationale.toLowerCase()).toContain("no providers");
  });

  test("fast preset prefers low-latency cloud providers", () => {
    const r = resolveVoiceRoute({
      preset: "fast",
      sttProviders: [avail("groq", "Groq", true), avail("deepgram", "Deepgram", true)],
      ttsProviders: [avail("cartesia", "Cartesia", true), avail("deepgram", "Deepgram", true)],
    });
    expect(r.stt?.providerId).toBe("groq");
    expect(r.tts?.providerId).toBe("cartesia");
    expect(r.fallbacksApplied).toEqual([]);
  });

  test("fast preset falls back across configured cloud providers", () => {
    const r = resolveVoiceRoute({
      preset: "fast",
      sttProviders: [
        avail("groq", "Groq", false),
        avail("deepgram", "Deepgram", true),
      ],
      ttsProviders: [
        avail("cartesia", "Cartesia", false),
        avail("deepgram", "Deepgram", true),
      ],
    });
    expect(r.stt?.providerId).toBe("deepgram");
    expect(r.tts?.providerId).toBe("deepgram");
    expect(r.fallbacksApplied).toEqual(["stt", "tts"]);
    expect(r.rationale.toLowerCase()).toContain("fell back");
  });

  test("quality preset picks elevenlabs TTS when configured", () => {
    const r = resolveVoiceRoute({
      preset: "quality",
      sttProviders: [avail("assemblyai", "AssemblyAI", true)],
      ttsProviders: [
        avail("elevenlabs", "ElevenLabs", true),
        avail("cartesia", "Cartesia", true),
      ],
    });
    expect(r.stt?.providerId).toBe("assemblyai");
    expect(r.tts?.providerId).toBe("elevenlabs");
  });

  test("expressive preset prefers hume when available", () => {
    const r = resolveVoiceRoute({
      preset: "expressive",
      sttProviders: [avail("assemblyai", "AssemblyAI", true)],
      ttsProviders: [avail("hume", "Hume", true), avail("elevenlabs", "ElevenLabs", true)],
    });
    expect(r.tts?.providerId).toBe("hume");
  });

  test("skips a configured provider that was probed unreachable", () => {
    const r = resolveVoiceRoute({
      preset: "fast",
      sttProviders: [avail("groq", "Groq", true, false), avail("deepgram", "Deepgram", true, true)],
      ttsProviders: [avail("cartesia", "Cartesia", true)],
    });
    expect(r.stt?.providerId).toBe("deepgram");
    expect(r.fallbacksApplied).toContain("stt");
  });

  test("routes to realtime when S2S is reachable", () => {
    const r = resolveVoiceRoute({
      preset: "local",
      sttProviders: [],
      ttsProviders: [],
      s2sReachable: true,
    });
    expect(r.transport.mode).toBe("realtime");
  });
});
