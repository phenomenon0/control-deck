import { describe, expect, test } from "bun:test";

import { resolveVoiceRoute } from "./resolve-voice-route";

function avail(id: string, name: string, configured = true, reachable: boolean | null = null) {
  return { id, name, configured, reachable };
}

describe("resolveVoiceRoute", () => {
  test("offline preset picks sidecar when reachable", () => {
    const r = resolveVoiceRoute({
      preset: "offline",
      sttProviders: [avail("voice-core", "Sidecar")],
      ttsProviders: [avail("voice-core", "Sidecar")],
      sidecarReachable: true,
    });
    expect(r.stt?.providerId).toBe("voice-core");
    expect(r.tts?.providerId).toBe("voice-core");
    expect(r.transport.usesSidecar).toBe(true);
    expect(r.fallbacksApplied).toEqual([]);
  });

  test("offline preset returns nothing when sidecar is down", () => {
    const r = resolveVoiceRoute({
      preset: "offline",
      sttProviders: [avail("voice-core", "Sidecar")],
      ttsProviders: [avail("voice-core", "Sidecar")],
      sidecarReachable: false,
    });
    expect(r.stt).toBeNull();
    expect(r.tts).toBeNull();
    expect(r.rationale.toLowerCase()).toContain("no providers");
  });

  test("fast preset prefers groq over sidecar for STT", () => {
    const r = resolveVoiceRoute({
      preset: "fast",
      sttProviders: [
        avail("voice-core", "Sidecar"),
        avail("groq", "Groq", true),
      ],
      ttsProviders: [
        avail("voice-core", "Sidecar"),
        avail("cartesia", "Cartesia", true),
      ],
      sidecarReachable: true,
    });
    expect(r.stt?.providerId).toBe("groq");
    expect(r.tts?.providerId).toBe("cartesia");
    expect(r.fallbacksApplied).toEqual([]);
  });

  test("fast preset falls back to sidecar when clouds unconfigured", () => {
    const r = resolveVoiceRoute({
      preset: "fast",
      sttProviders: [
        avail("voice-core", "Sidecar"),
        avail("groq", "Groq", false),
        avail("deepgram", "Deepgram", false),
      ],
      ttsProviders: [
        avail("voice-core", "Sidecar"),
        avail("cartesia", "Cartesia", false),
      ],
      sidecarReachable: true,
    });
    expect(r.stt?.providerId).toBe("voice-core");
    expect(r.tts?.providerId).toBe("voice-core");
    expect(r.fallbacksApplied).toEqual(["stt", "tts"]);
    expect(r.rationale.toLowerCase()).toContain("fell back");
  });

  test("quality preset picks elevenlabs TTS when configured", () => {
    const r = resolveVoiceRoute({
      preset: "quality",
      sttProviders: [avail("assemblyai", "AssemblyAI", true), avail("voice-core", "Sidecar")],
      ttsProviders: [
        avail("elevenlabs", "ElevenLabs", true),
        avail("voice-core", "Sidecar"),
      ],
      sidecarReachable: true,
    });
    expect(r.stt?.providerId).toBe("assemblyai");
    expect(r.tts?.providerId).toBe("elevenlabs");
  });

  test("expressive preset prefers hume when available", () => {
    const r = resolveVoiceRoute({
      preset: "expressive",
      sttProviders: [avail("assemblyai", "AssemblyAI", true)],
      ttsProviders: [avail("hume", "Hume", true), avail("elevenlabs", "ElevenLabs", true)],
      sidecarReachable: false,
    });
    expect(r.tts?.providerId).toBe("hume");
  });

  test("skips a configured provider that was probed unreachable", () => {
    const r = resolveVoiceRoute({
      preset: "fast",
      sttProviders: [avail("groq", "Groq", true, false), avail("deepgram", "Deepgram", true, true)],
      ttsProviders: [avail("voice-core", "Sidecar")],
      sidecarReachable: true,
    });
    expect(r.stt?.providerId).toBe("deepgram");
    expect(r.fallbacksApplied).toContain("stt");
  });
});
