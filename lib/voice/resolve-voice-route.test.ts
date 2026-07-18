import { describe, expect, test } from "bun:test";

import { resolveVoiceRoute } from "./resolve-voice-route";

function avail(id: string, name: string, configured = true, reachable: boolean | null = null) {
  return { id, name, configured, reachable };
}

describe("resolveVoiceRoute", () => {
  test("offline preset resolves the local omni provider for both modalities", () => {
    const r = resolveVoiceRoute({
      preset: "offline",
      sttProviders: [avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", true, true)],
      ttsProviders: [avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", true, true)],
    });
    expect(r.stt?.providerId).toBe("qwen-omni-local");
    expect(r.stt?.model).toBe("Qwen/Qwen2.5-Omni-7B-AWQ");
    expect(r.tts?.providerId).toBe("qwen-omni-local");
    expect(r.tts?.model).toBe("Qwen/Qwen2.5-Omni-7B-AWQ");
    expect(r.fallbacksApplied).toEqual([]);
  });

  test("offline preset never resolves a cloud provider, even when healthy", () => {
    const r = resolveVoiceRoute({
      preset: "offline",
      sttProviders: [avail("groq", "Groq", true, true), avail("deepgram", "Deepgram", true, true)],
      ttsProviders: [avail("cartesia", "Cartesia", true, true)],
    });
    expect(r.stt).toBeNull();
    expect(r.tts).toBeNull();
    expect(r.transport.mode).toBe("app-gateway");
    expect(r.rationale.toLowerCase()).toContain("no providers");
  });

  test("offline preset skips an unavailable local provider instead of falling back to cloud", () => {
    const r = resolveVoiceRoute({
      preset: "offline",
      sttProviders: [
        avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", true, false),
        avail("groq", "Groq", true, true),
      ],
      ttsProviders: [
        avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", false),
        avail("cartesia", "Cartesia", true, true),
      ],
    });
    expect(r.stt).toBeNull();
    expect(r.tts).toBeNull();
  });

  test("local preset prefers the local omni provider for both modalities", () => {
    const r = resolveVoiceRoute({
      preset: "local",
      sttProviders: [avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", true, true), avail("groq", "Groq", true, true)],
      ttsProviders: [avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", true, true), avail("cartesia", "Cartesia", true, true)],
    });
    expect(r.stt?.providerId).toBe("qwen-omni-local");
    expect(r.stt?.model).toBe("Qwen/Qwen2.5-Omni-7B-AWQ");
    expect(r.tts?.providerId).toBe("qwen-omni-local");
    expect(r.tts?.model).toBe("Qwen/Qwen2.5-Omni-7B-AWQ");
    expect(r.fallbacksApplied).toEqual([]);
  });

  test("local preset falls back to cloud when the local provider is not registered", () => {
    const r = resolveVoiceRoute({
      preset: "local",
      sttProviders: [avail("groq", "Groq", true, true)],
      ttsProviders: [avail("cartesia", "Cartesia", true, true)],
    });
    expect(r.stt?.providerId).toBe("groq");
    expect(r.tts?.providerId).toBe("cartesia");
    // The local provider was never registered, so this is the primary pick,
    // not a fallback from a failed provider.
    expect(r.fallbacksApplied).toEqual([]);
  });

  test("local preset falls back to cloud when the local provider is unavailable", () => {
    const r = resolveVoiceRoute({
      preset: "local",
      sttProviders: [
        avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", true, false),
        avail("groq", "Groq", true, true),
      ],
      ttsProviders: [
        avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", false),
        avail("deepgram", "Deepgram", true, true),
      ],
    });
    expect(r.stt?.providerId).toBe("groq");
    expect(r.tts?.providerId).toBe("deepgram");
    expect(r.fallbacksApplied).toEqual(["stt", "tts"]);
    expect(r.rationale.toLowerCase()).toContain("fell back");
  });

  test("local preset mixes local STT with cloud TTS fallback", () => {
    const r = resolveVoiceRoute({
      preset: "local",
      sttProviders: [avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", true, true)],
      ttsProviders: [
        avail("qwen-omni-local", "Qwen2.5 Omni AWQ (local)", true, false),
        avail("cartesia", "Cartesia", true, true),
      ],
    });
    expect(r.stt?.providerId).toBe("qwen-omni-local");
    expect(r.tts?.providerId).toBe("cartesia");
    expect(r.fallbacksApplied).toEqual(["tts"]);
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
