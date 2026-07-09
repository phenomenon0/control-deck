import { describe, expect, test } from "bun:test";

import {
  AGENT_LLM_BASE_URL,
  DEFAULT_DIRECT_LLM_BASE_URL,
  DEFAULT_KNOBS,
  buildLaunchConfig,
  knobsFromLaunchConfig,
} from "./store";

describe("voice lab store config mapping", () => {
  test("maps LaunchConfig-shaped knobs to a supervisor restart payload", () => {
    const payload = buildLaunchConfig(
      {
        ...DEFAULT_KNOBS,
        stt: "faster-whisper",
        tts: "kokoro",
        responses_api_base_url: AGENT_LLM_BASE_URL,
        model_name: "deck-agent",
      },
      {
        worker_port: 9999,
        num_pipelines: 8,
        responses_api_api_key: "********",
      } as Record<string, unknown>,
    );

    expect(payload.mode).toBe("realtime");
    expect(payload.num_pipelines).toBe(1);
    expect(payload.worker_port).toBe(DEFAULT_KNOBS.worker_port);
    expect(payload.stt).toBe("faster-whisper");
    expect(payload.tts).toBe("kokoro");
    expect(payload.responses_api_base_url).toBe(AGENT_LLM_BASE_URL);
    expect(payload.responses_api_api_key).toBe(DEFAULT_KNOBS.responses_api_api_key);
    expect(payload).not.toHaveProperty("sttEngine");
    expect(payload).not.toHaveProperty("correctionEngine");
    expect(payload).not.toHaveProperty("ttsEngine");
    expect(payload).not.toHaveProperty("vadThreshold");
  });

  test("recovers direct LLM preset and ignores redacted API keys from status", () => {
    const mapped = knobsFromLaunchConfig({
      stt: "parakeet-tdt",
      llm_backend: "chat-completions",
      responses_api_base_url: DEFAULT_DIRECT_LLM_BASE_URL,
      responses_api_api_key: "********",
      tts: "qwen3",
    });

    expect(mapped.llmPreset).toBe("direct");
    expect(mapped.directBaseUrl).toBe(DEFAULT_DIRECT_LLM_BASE_URL);
    expect(mapped.knobs.responses_api_api_key).toBe(DEFAULT_KNOBS.responses_api_api_key);
  });
});
