import { describe, expect, test } from "bun:test";

import {
  AGENT_LLM_BASE_URL,
  CONFIG_FIELDS,
  DEFAULT_DIRECT_LLM_BASE_URL,
  DEFAULT_KNOBS,
  LAUNCH_CONFIG_KEYS,
  buildLaunchConfig,
  isFieldVisible,
  isLaunchConfigDirty,
  knobsFromLaunchConfig,
  sanitizeLaunchConfig,
  secretRedactionsFromLaunchConfig,
  type LabKnobs,
  type LaunchConfigKey,
} from "./store";

const UPSTREAM_LAUNCH_CONFIG_KEYS = [
  "mode",
  "worker_host",
  "worker_port",
  "device",
  "num_pipelines",
  "log_level",
  "stt",
  "llm_backend",
  "tts",
  "enable_live_transcription",
  "live_transcription_update_interval",
  "init_chat_prompt",
  "chat_size",
  "stream_batch_sentences",
  "compact_history",
  "model_name",
  "responses_api_base_url",
  "responses_api_api_key",
  "responses_api_stream",
  "responses_api_disable_thinking",
  "llm_device",
  "llm_torch_dtype",
  "llm_gen_max_new_tokens",
  "llm_gen_temperature",
  "llm_gen_do_sample",
  "stt_model_name",
  "stt_device",
  "stt_language",
  "faster_whisper_stt_model_name",
  "faster_whisper_stt_device",
  "mlx_audio_whisper_model_name",
  "paraformer_stt_model_name",
  "paraformer_stt_device",
  "parakeet_tdt_model_name",
  "parakeet_tdt_device",
  "parakeet_tdt_language",
  "qwen3_tts_model_name",
  "qwen3_tts_device",
  "qwen3_tts_backend",
  "qwen3_tts_speaker",
  "qwen3_tts_language",
  "qwen3_tts_streaming_chunk_size",
  "qwen3_tts_non_streaming_mode",
  "qwen3_tts_mlx_quantization",
  "kokoro_model_name",
  "kokoro_device",
  "kokoro_voice",
  "kokoro_lang_code",
  "kokoro_speed",
  "pocket_tts_device",
  "pocket_tts_voice",
  "facebook_mms_model_name",
  "facebook_mms_device",
  "tts_language",
  "chat_tts_device",
] as const satisfies readonly LaunchConfigKey[];

describe("voice lab LaunchConfig schema", () => {
  test("covers every upstream LaunchConfig field exactly once", () => {
    expect([...LAUNCH_CONFIG_KEYS]).toEqual([...UPSTREAM_LAUNCH_CONFIG_KEYS]);
    expect(CONFIG_FIELDS.map((field) => field.key)).toEqual([...UPSTREAM_LAUNCH_CONFIG_KEYS]);
    expect(new Set(LAUNCH_CONFIG_KEYS).size).toBe(UPSTREAM_LAUNCH_CONFIG_KEYS.length);
    expect(CONFIG_FIELDS.length).toBe(55);
  });

  test("maps full LaunchConfig-shaped knobs to a supervisor restart payload", () => {
    const knobs: LabKnobs = {
      ...DEFAULT_KNOBS,
      worker_port: 9999,
      num_pipelines: 8,
      stt: "faster-whisper",
      tts: "kokoro",
      responses_api_base_url: AGENT_LLM_BASE_URL,
      model_name: "deck-agent",
    };
    const payload = buildLaunchConfig(knobs);

    expect(payload.mode).toBe("realtime");
    expect(payload.num_pipelines).toBe(8);
    expect(payload.worker_port).toBe(9999);
    expect(payload.stt).toBe("faster-whisper");
    expect(payload.tts).toBe("kokoro");
    expect(payload.responses_api_base_url).toBe(AGENT_LLM_BASE_URL);
    expect(payload).not.toHaveProperty("sttEngine");
    expect(payload).not.toHaveProperty("correctionEngine");
    expect(payload).not.toHaveProperty("ttsEngine");
    expect(payload).not.toHaveProperty("vadThreshold");
  });

  test("keeps redacted API keys out of config state and apply payloads unless edited", () => {
    const sanitized = sanitizeLaunchConfig({
      model_name: "deck-agent",
      responses_api_api_key: "********",
    });
    expect(sanitized).toEqual({ model_name: "deck-agent" });
    expect(secretRedactionsFromLaunchConfig({ responses_api_api_key: "********" }).responses_api_api_key).toBe(true);

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

    const payload = buildLaunchConfig(mapped.knobs, null, { includeApiKey: false });
    expect(payload).not.toHaveProperty("responses_api_api_key");
  });

  test("encodes conditional visibility for backend-specific fields", () => {
    const field = fieldByKey();

    expect(isFieldVisible(field.stt_model_name, { ...DEFAULT_KNOBS, stt: "whisper" })).toBe(true);
    expect(isFieldVisible(field.stt_model_name, { ...DEFAULT_KNOBS, stt: "parakeet-tdt" })).toBe(false);
    expect(isFieldVisible(field.faster_whisper_stt_model_name, { ...DEFAULT_KNOBS, stt: "faster-whisper" })).toBe(true);
    expect(isFieldVisible(field.mlx_audio_whisper_model_name, { ...DEFAULT_KNOBS, stt: "mlx-audio-whisper" })).toBe(true);
    expect(isFieldVisible(field.paraformer_stt_device, { ...DEFAULT_KNOBS, stt: "paraformer" })).toBe(true);
    expect(isFieldVisible(field.parakeet_tdt_device, { ...DEFAULT_KNOBS, stt: "parakeet-tdt" })).toBe(true);

    expect(isFieldVisible(field.responses_api_base_url, { ...DEFAULT_KNOBS, llm_backend: "chat-completions" })).toBe(true);
    expect(isFieldVisible(field.responses_api_base_url, { ...DEFAULT_KNOBS, llm_backend: "responses-api" })).toBe(true);
    expect(isFieldVisible(field.responses_api_base_url, { ...DEFAULT_KNOBS, llm_backend: "transformers" })).toBe(false);
    expect(isFieldVisible(field.llm_device, { ...DEFAULT_KNOBS, llm_backend: "transformers" })).toBe(true);
    expect(isFieldVisible(field.llm_device, { ...DEFAULT_KNOBS, llm_backend: "mlx-lm" })).toBe(true);
    expect(isFieldVisible(field.llm_device, { ...DEFAULT_KNOBS, llm_backend: "chat-completions" })).toBe(false);
    expect(isFieldVisible(field.llm_gen_temperature, { ...DEFAULT_KNOBS, llm_backend: "chat-completions" })).toBe(true);

    expect(isFieldVisible(field.qwen3_tts_backend, { ...DEFAULT_KNOBS, tts: "qwen3" })).toBe(true);
    expect(isFieldVisible(field.qwen3_tts_backend, { ...DEFAULT_KNOBS, tts: "kokoro" })).toBe(false);
    expect(isFieldVisible(field.kokoro_speed, { ...DEFAULT_KNOBS, tts: "kokoro" })).toBe(true);
    expect(isFieldVisible(field.pocket_tts_voice, { ...DEFAULT_KNOBS, tts: "pocket" })).toBe(true);
    expect(isFieldVisible(field.facebook_mms_model_name, { ...DEFAULT_KNOBS, tts: "facebookMMS" })).toBe(true);
    expect(isFieldVisible(field.chat_tts_device, { ...DEFAULT_KNOBS, tts: "chatTTS" })).toBe(true);
  });

  test("detects dirty state and supports reset-to-active/default config behavior", () => {
    const active: LabKnobs = {
      ...DEFAULT_KNOBS,
      worker_port: 9999,
      model_name: "active-model",
    };

    expect(isLaunchConfigDirty({ ...active }, active)).toBe(false);
    expect(isLaunchConfigDirty({ ...active, model_name: "changed-model" }, active)).toBe(true);
    expect(
      isLaunchConfigDirty(
        { ...active, responses_api_api_key: "typed-secret" },
        active,
        {
          redactedSecrets: { responses_api_api_key: true },
          editedSecrets: { responses_api_api_key: false },
        },
      ),
    ).toBe(false);
    expect(
      isLaunchConfigDirty(
        { ...active, responses_api_api_key: "typed-secret" },
        active,
        {
          redactedSecrets: { responses_api_api_key: true },
          editedSecrets: { responses_api_api_key: true },
        },
      ),
    ).toBe(true);

    const activeReset = knobsFromLaunchConfig(active).knobs;
    expect(activeReset.worker_port).toBe(9999);
    expect(activeReset.model_name).toBe("active-model");

    const defaultReset = knobsFromLaunchConfig(DEFAULT_KNOBS).knobs;
    expect(defaultReset.worker_port).toBe(DEFAULT_KNOBS.worker_port);
    expect(defaultReset.model_name).toBe(DEFAULT_KNOBS.model_name);
  });
});

function fieldByKey() {
  return Object.fromEntries(CONFIG_FIELDS.map((field) => [field.key, field])) as {
    [K in LaunchConfigKey]: Extract<(typeof CONFIG_FIELDS)[number], { key: K }>;
  };
}
