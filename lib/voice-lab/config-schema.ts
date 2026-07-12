export const DEFAULT_DIRECT_LLM_BASE_URL = "http://127.0.0.1:11434/v1";

export const LOCAL_VOICE_PROMPT =
  "You are a fast local voice assistant. Answer naturally in one or two short sentences. " +
  "Avoid lists unless asked.";

export const STT_BACKENDS = [
  "whisper",
  "whisper-mlx",
  "mlx-audio-whisper",
  "faster-whisper",
  "parakeet-tdt",
  "paraformer",
] as const;
export type SttBackend = (typeof STT_BACKENDS)[number];

export const LLM_BACKENDS = ["transformers", "mlx-lm", "responses-api", "chat-completions"] as const;
export type LlmBackend = (typeof LLM_BACKENDS)[number];

export const TTS_BACKENDS = ["chatTTS", "facebookMMS", "pocket", "kokoro", "qwen3"] as const;
export type TtsBackend = (typeof TTS_BACKENDS)[number];

export const LOG_LEVELS = ["debug", "info", "warning", "error", "critical"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const QWEN3_TTS_BACKENDS = ["ggml", "torch"] as const;
export type Qwen3TtsBackend = (typeof QWEN3_TTS_BACKENDS)[number];

export interface VoiceLabConfig {
  mode: "realtime";
  worker_host: string;
  worker_port: number;
  device: string | null;
  num_pipelines: number;
  log_level: LogLevel;

  stt: SttBackend;
  llm_backend: LlmBackend;
  tts: TtsBackend;

  enable_live_transcription: boolean;
  live_transcription_update_interval: number;

  init_chat_prompt: string;
  chat_size: number;
  stream_batch_sentences: number;
  compact_history: boolean;

  model_name: string;
  responses_api_base_url: string | null;
  responses_api_api_key: string | null;
  responses_api_stream: boolean;
  responses_api_disable_thinking: boolean;
  llm_device: string | null;
  llm_torch_dtype: string;
  llm_gen_max_new_tokens: number;
  llm_gen_temperature: number;
  llm_gen_do_sample: boolean;

  stt_model_name: string | null;
  stt_device: string | null;
  stt_language: string | null;
  faster_whisper_stt_model_name: string | null;
  faster_whisper_stt_device: string | null;
  mlx_audio_whisper_model_name: string | null;
  paraformer_stt_model_name: string | null;
  paraformer_stt_device: string | null;
  parakeet_tdt_model_name: string | null;
  parakeet_tdt_device: string;
  parakeet_tdt_language: string | null;

  qwen3_tts_model_name: string;
  qwen3_tts_device: string | null;
  qwen3_tts_backend: Qwen3TtsBackend;
  qwen3_tts_speaker: string | null;
  qwen3_tts_language: string;
  qwen3_tts_ref_audio: string | null;
  qwen3_tts_ref_text: string | null;
  qwen3_tts_streaming_chunk_size: number | null;
  qwen3_tts_non_streaming_mode: boolean | null;
  qwen3_tts_mlx_quantization: string | null;

  kokoro_model_name: string | null;
  kokoro_device: string;
  kokoro_voice: string;
  kokoro_lang_code: string;
  kokoro_speed: number;

  pocket_tts_device: string;
  pocket_tts_voice: string;

  facebook_mms_model_name: string;
  facebook_mms_device: string;
  tts_language: string;

  chat_tts_device: string;
}

export type LaunchConfigKey = keyof VoiceLabConfig;

export const CONFIG_GROUPS = [
  { id: "runtime", label: "Runtime", help: "Worker process, concurrency, and logging." },
  { id: "engines", label: "Engines", help: "Choose the STT, LLM, and TTS backends." },
  { id: "conversation", label: "Conversation", help: "Prompting, transcript streaming, and turn history." },
  { id: "llm", label: "LLM", help: "Model routing and generation behavior." },
  { id: "stt", label: "STT engine", help: "Backend-specific speech recognition settings." },
  { id: "tts", label: "TTS engine", help: "Backend-specific speech synthesis settings." },
] as const;
export type ConfigGroupId = (typeof CONFIG_GROUPS)[number]["id"];

export type ConfigInput = "select" | "number" | "toggle" | "text" | "textarea";

export interface ShowWhenCondition {
  key: LaunchConfigKey;
  equals: VoiceLabConfig[LaunchConfigKey] | readonly VoiceLabConfig[LaunchConfigKey][];
}

interface FieldBase<K extends LaunchConfigKey> {
  key: K;
  label: string;
  help: string;
  group: ConfigGroupId;
  input: ConfigInput;
  default: VoiceLabConfig[K];
  nullable?: boolean;
  showWhen?: ShowWhenCondition | readonly ShowWhenCondition[];
}

export type LaunchConfigField<K extends LaunchConfigKey = LaunchConfigKey> =
  | (FieldBase<K> & {
      input: "select";
      options: readonly Extract<NonNullable<VoiceLabConfig[K]>, string>[];
    })
  | (FieldBase<K> & {
      input: "number";
      min?: number;
      max?: number;
      step?: number;
    })
  | (FieldBase<K> & {
      input: "toggle" | "text" | "textarea";
    });

function field<K extends LaunchConfigKey>(config: LaunchConfigField<K>): LaunchConfigField<K> {
  return config;
}

const sttWhisper: ShowWhenCondition = { key: "stt", equals: "whisper" };
const sttFasterWhisper: ShowWhenCondition = { key: "stt", equals: "faster-whisper" };
const sttMlxAudioWhisper: ShowWhenCondition = { key: "stt", equals: "mlx-audio-whisper" };
const sttParaformer: ShowWhenCondition = { key: "stt", equals: "paraformer" };
const sttParakeet: ShowWhenCondition = { key: "stt", equals: "parakeet-tdt" };
const apiLlm: ShowWhenCondition = { key: "llm_backend", equals: ["responses-api", "chat-completions"] };
const localLlm: ShowWhenCondition = { key: "llm_backend", equals: ["transformers", "mlx-lm"] };
const ttsQwen3: ShowWhenCondition = { key: "tts", equals: "qwen3" };
const ttsKokoro: ShowWhenCondition = { key: "tts", equals: "kokoro" };
const ttsPocket: ShowWhenCondition = { key: "tts", equals: "pocket" };
const ttsFacebookMms: ShowWhenCondition = { key: "tts", equals: "facebookMMS" };
const ttsChatTts: ShowWhenCondition = { key: "tts", equals: "chatTTS" };

export const CONFIG_FIELDS = [
  field({
    key: "mode",
    label: "Mode",
    help: "Supervisor mode. Realtime is the only LaunchConfig mode currently accepted.",
    group: "runtime",
    input: "select",
    options: ["realtime"],
    default: "realtime",
  }),
  field({
    key: "worker_host",
    label: "Worker host",
    help: "Host interface for the realtime worker. Keep loopback unless another device must connect.",
    group: "runtime",
    input: "text",
    default: "127.0.0.1",
  }),
  field({
    key: "worker_port",
    label: "Worker port",
    help: "Port for the realtime worker websocket and pool API. Change when 8765 is occupied.",
    group: "runtime",
    input: "number",
    min: 1,
    max: 65535,
    step: 1,
    default: 8765,
  }),
  field({
    key: "device",
    label: "Default device",
    help: "Fallback compute device shared by engines. Use cuda, cpu, mps, auto, or blank for engine defaults.",
    group: "runtime",
    input: "text",
    nullable: true,
    default: "cuda",
  }),
  field({
    key: "num_pipelines",
    label: "Pipeline slots",
    help: "Realtime worker concurrency. Raise only when the machine can run parallel voice pipelines.",
    group: "runtime",
    input: "number",
    min: 1,
    max: 16,
    step: 1,
    default: 1,
  }),
  field({
    key: "log_level",
    label: "Log level",
    help: "Supervisor and worker log verbosity. Use debug only while diagnosing launch issues.",
    group: "runtime",
    input: "select",
    options: LOG_LEVELS,
    default: "info",
  }),

  field({
    key: "stt",
    label: "STT backend",
    help: "Speech-to-text engine used before the assistant turn.",
    group: "engines",
    input: "select",
    options: STT_BACKENDS,
    default: "parakeet-tdt",
  }),
  field({
    key: "llm_backend",
    label: "LLM backend",
    help: "Assistant backend. API backends use OpenAI-compatible endpoints; local backends load models directly.",
    group: "engines",
    input: "select",
    options: LLM_BACKENDS,
    default: "chat-completions",
  }),
  field({
    key: "tts",
    label: "TTS backend",
    help: "Text-to-speech engine used for the assistant response.",
    group: "engines",
    input: "select",
    options: TTS_BACKENDS,
    default: "qwen3",
  }),

  field({
    key: "enable_live_transcription",
    label: "Live transcription",
    help: "Stream partial transcripts while the user speaks. Disable when partial text is distracting.",
    group: "conversation",
    input: "toggle",
    default: true,
  }),
  field({
    key: "live_transcription_update_interval",
    label: "Transcript interval",
    help: "Seconds between live transcript updates. Lower values feel faster but add UI and network churn.",
    group: "conversation",
    input: "number",
    min: 0.05,
    max: 10,
    step: 0.05,
    default: 0.5,
  }),
  field({
    key: "init_chat_prompt",
    label: "Initial chat prompt",
    help: "System prompt for the voice assistant. Keep it short for faster spoken turns.",
    group: "conversation",
    input: "textarea",
    default: LOCAL_VOICE_PROMPT,
  }),
  field({
    key: "chat_size",
    label: "Chat size",
    help: "Maximum conversation turns kept in context. Raise for memory, lower for latency.",
    group: "conversation",
    input: "number",
    min: 1,
    max: 200,
    step: 1,
    default: 16,
  }),
  field({
    key: "stream_batch_sentences",
    label: "Stream batch sentences",
    help: "Sentences buffered before TTS starts speaking. 1 = lowest latency.",
    group: "conversation",
    input: "number",
    min: 1,
    max: 20,
    step: 1,
    default: 1,
  }),
  field({
    key: "compact_history",
    label: "Compact history",
    help: "Let the pipeline compact older chat history. Enable for longer sessions with small context windows.",
    group: "conversation",
    input: "toggle",
    default: false,
  }),

  field({
    key: "model_name",
    label: "Model name",
    help: "LLM model identifier sent to the selected backend.",
    group: "llm",
    input: "text",
    default: "qwen3.5:latest",
  }),
  field({
    key: "responses_api_base_url",
    label: "Responses API base URL",
    help: "OpenAI-compatible endpoint for responses-api or chat-completions. The brain toggle can manage this.",
    group: "llm",
    input: "text",
    nullable: true,
    showWhen: apiLlm,
    default: DEFAULT_DIRECT_LLM_BASE_URL,
  }),
  field({
    key: "responses_api_api_key",
    label: "Responses API key",
    help: "API key for the selected endpoint. Redacted active keys are kept unless you type a replacement.",
    group: "llm",
    input: "text",
    nullable: true,
    showWhen: apiLlm,
    default: "local-not-needed",
  }),
  field({
    key: "responses_api_stream",
    label: "Responses stream",
    help: "Stream LLM tokens from API backends. Keep enabled for lower voice latency.",
    group: "llm",
    input: "toggle",
    showWhen: apiLlm,
    default: true,
  }),
  field({
    key: "responses_api_disable_thinking",
    label: "Disable thinking",
    help: "Ask compatible API models to suppress reasoning text before speech.",
    group: "llm",
    input: "toggle",
    showWhen: apiLlm,
    default: true,
  }),
  field({
    key: "llm_device",
    label: "LLM device",
    help: "Device for local LLM backends. Blank falls back to the runtime default device.",
    group: "llm",
    input: "text",
    nullable: true,
    showWhen: localLlm,
    default: null,
  }),
  field({
    key: "llm_torch_dtype",
    label: "LLM torch dtype",
    help: "Torch dtype for local transformer-style LLM loading. Change when a model needs a specific precision.",
    group: "llm",
    input: "text",
    showWhen: localLlm,
    default: "bfloat16",
  }),
  field({
    key: "llm_gen_max_new_tokens",
    label: "Max new tokens",
    help: "Maximum generated tokens per assistant turn. Raise for longer answers, lower for latency.",
    group: "llm",
    input: "number",
    min: 1,
    max: 8192,
    step: 1,
    default: 96,
  }),
  field({
    key: "llm_gen_temperature",
    label: "Temperature",
    help: "Sampling temperature for LLM generation. 0 is deterministic, higher is more varied.",
    group: "llm",
    input: "number",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0,
  }),
  field({
    key: "llm_gen_do_sample",
    label: "Sample generation",
    help: "Enable stochastic sampling for generation. Pair with a nonzero temperature.",
    group: "llm",
    input: "toggle",
    default: false,
  }),

  field({
    key: "stt_model_name",
    label: "Whisper model",
    help: "Model name for the transformers Whisper STT backend.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttWhisper,
    default: null,
  }),
  field({
    key: "stt_device",
    label: "Whisper device",
    help: "Device for the transformers Whisper STT backend. Blank uses the runtime default device.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttWhisper,
    default: null,
  }),
  field({
    key: "stt_language",
    label: "STT language",
    help: "Language hint for Whisper-style recognition. Blank lets the backend auto-detect when supported.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: [{ key: "stt", equals: ["whisper", "mlx-audio-whisper"] }],
    default: null,
  }),
  field({
    key: "faster_whisper_stt_model_name",
    label: "Faster Whisper model",
    help: "Model name for faster-whisper recognition.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttFasterWhisper,
    default: null,
  }),
  field({
    key: "faster_whisper_stt_device",
    label: "Faster Whisper device",
    help: "Device for faster-whisper. Blank uses the runtime default device.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttFasterWhisper,
    default: null,
  }),
  field({
    key: "mlx_audio_whisper_model_name",
    label: "MLX Audio Whisper model",
    help: "Model name for mlx-audio-whisper on Apple Silicon.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttMlxAudioWhisper,
    default: null,
  }),
  field({
    key: "paraformer_stt_model_name",
    label: "Paraformer model",
    help: "Model name for Paraformer recognition.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttParaformer,
    default: null,
  }),
  field({
    key: "paraformer_stt_device",
    label: "Paraformer device",
    help: "Device for Paraformer. Blank uses the runtime default device.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttParaformer,
    default: null,
  }),
  field({
    key: "parakeet_tdt_model_name",
    label: "Parakeet TDT model",
    help: "NVIDIA Parakeet model name for low-latency English recognition.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttParakeet,
    default: "nvidia/parakeet-tdt-0.6b-v3",
  }),
  field({
    key: "parakeet_tdt_device",
    label: "Parakeet TDT device",
    help: "Device selection for Parakeet TDT. Auto lets the backend choose.",
    group: "stt",
    input: "text",
    showWhen: sttParakeet,
    default: "auto",
  }),
  field({
    key: "parakeet_tdt_language",
    label: "Parakeet TDT language",
    help: "Language hint for Parakeet TDT. Blank uses backend auto behavior.",
    group: "stt",
    input: "text",
    nullable: true,
    showWhen: sttParakeet,
    default: null,
  }),

  field({
    key: "qwen3_tts_model_name",
    label: "Qwen3 TTS model",
    help: "Qwen3 TTS model identifier. Change when switching voice model variants.",
    group: "tts",
    input: "text",
    showWhen: ttsQwen3,
    default: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
  }),
  field({
    key: "qwen3_tts_device",
    label: "Qwen3 TTS device",
    help: "Device for Qwen3 TTS. Blank falls back to the runtime default device.",
    group: "tts",
    input: "text",
    nullable: true,
    showWhen: ttsQwen3,
    default: null,
  }),
  field({
    key: "qwen3_tts_backend",
    label: "Qwen3 TTS backend",
    help: "Runtime backend for Qwen3 TTS. Use ggml for lightweight local serving, torch for PyTorch.",
    group: "tts",
    input: "select",
    options: QWEN3_TTS_BACKENDS,
    showWhen: ttsQwen3,
    default: "ggml",
  }),
  field({
    key: "qwen3_tts_speaker",
    label: "Qwen3 speaker",
    help: "Speaker preset for Qwen3 TTS. Blank lets the model use its default voice.",
    group: "tts",
    input: "text",
    nullable: true,
    showWhen: ttsQwen3,
    default: "Aiden",
  }),
  field({
    key: "qwen3_tts_language",
    label: "Qwen3 language",
    help: "Language code for Qwen3 TTS. Auto lets the backend infer it from text.",
    group: "tts",
    input: "text",
    showWhen: ttsQwen3,
    default: "auto",
  }),
  field({
    key: "qwen3_tts_ref_audio",
    label: "Qwen3 reference audio",
    help: "absolute path to a 5-20s clean reference clip — the voice to clone",
    group: "tts",
    input: "text",
    nullable: true,
    showWhen: ttsQwen3,
    default: null,
  }),
  field({
    key: "qwen3_tts_ref_text",
    label: "Qwen3 reference transcript",
    help: "exact transcript of the reference clip",
    group: "tts",
    input: "textarea",
    nullable: true,
    showWhen: ttsQwen3,
    default: null,
  }),
  field({
    key: "qwen3_tts_streaming_chunk_size",
    label: "Qwen3 chunk size",
    help: "Streaming audio chunk size. Smaller chunks can reduce latency; larger chunks can sound steadier.",
    group: "tts",
    input: "number",
    min: 1,
    max: 128,
    step: 1,
    nullable: true,
    showWhen: ttsQwen3,
    default: 8,
  }),
  field({
    key: "qwen3_tts_non_streaming_mode",
    label: "Qwen3 non-streaming",
    help: "Use non-streaming synthesis behavior when the backend supports both modes.",
    group: "tts",
    input: "toggle",
    nullable: true,
    showWhen: ttsQwen3,
    default: true,
  }),
  field({
    key: "qwen3_tts_mlx_quantization",
    label: "Qwen3 MLX quantization",
    help: "MLX quantization profile for Qwen3 TTS. Change only when using an MLX-compatible model.",
    group: "tts",
    input: "text",
    nullable: true,
    showWhen: ttsQwen3,
    default: "6bit",
  }),

  field({
    key: "kokoro_model_name",
    label: "Kokoro model",
    help: "Kokoro model identifier. Blank uses the backend default model.",
    group: "tts",
    input: "text",
    nullable: true,
    showWhen: ttsKokoro,
    default: null,
  }),
  field({
    key: "kokoro_device",
    label: "Kokoro device",
    help: "Device for Kokoro synthesis. Auto lets the backend pick.",
    group: "tts",
    input: "text",
    showWhen: ttsKokoro,
    default: "auto",
  }),
  field({
    key: "kokoro_voice",
    label: "Kokoro voice",
    help: "Kokoro voice preset used for speech output.",
    group: "tts",
    input: "text",
    showWhen: ttsKokoro,
    default: "bm_fable",
  }),
  field({
    key: "kokoro_lang_code",
    label: "Kokoro language",
    help: "Kokoro language code. Change when using non-default voice packs.",
    group: "tts",
    input: "text",
    showWhen: ttsKokoro,
    default: "b",
  }),
  field({
    key: "kokoro_speed",
    label: "Kokoro speed",
    help: "Speech speed multiplier. Must be greater than 0; 1 is normal speed.",
    group: "tts",
    input: "number",
    min: 0,
    max: 4,
    step: 0.05,
    showWhen: ttsKokoro,
    default: 1,
  }),

  field({
    key: "pocket_tts_device",
    label: "Pocket TTS device",
    help: "Device for Pocket TTS synthesis.",
    group: "tts",
    input: "text",
    showWhen: ttsPocket,
    default: "cpu",
  }),
  field({
    key: "pocket_tts_voice",
    label: "Pocket TTS voice",
    help: "Pocket TTS voice preset.",
    group: "tts",
    input: "text",
    showWhen: ttsPocket,
    default: "jean",
  }),

  field({
    key: "facebook_mms_model_name",
    label: "Facebook MMS model",
    help: "Facebook MMS TTS model identifier.",
    group: "tts",
    input: "text",
    showWhen: ttsFacebookMms,
    default: "facebook/mms-tts-eng",
  }),
  field({
    key: "facebook_mms_device",
    label: "Facebook MMS device",
    help: "Device for Facebook MMS synthesis.",
    group: "tts",
    input: "text",
    showWhen: ttsFacebookMms,
    default: "cuda",
  }),
  field({
    key: "tts_language",
    label: "TTS language",
    help: "Language code passed to Facebook MMS TTS.",
    group: "tts",
    input: "text",
    showWhen: ttsFacebookMms,
    default: "en",
  }),

  field({
    key: "chat_tts_device",
    label: "ChatTTS device",
    help: "Device for ChatTTS synthesis.",
    group: "tts",
    input: "text",
    showWhen: ttsChatTts,
    default: "cuda",
  }),
] as const;

export const LAUNCH_CONFIG_KEYS = CONFIG_FIELDS.map((configField) => configField.key) as readonly LaunchConfigKey[];

export const NULLABLE_CONFIG_KEYS = CONFIG_FIELDS.filter((configField) => configField.nullable).map(
  (configField) => configField.key,
) as readonly LaunchConfigKey[];

export const DEFAULT_LAUNCH_CONFIG = Object.freeze(
  CONFIG_FIELDS.reduce(
    (config, configField) => {
      config[configField.key] = configField.default;
      return config;
    },
    {} as Record<LaunchConfigKey, VoiceLabConfig[LaunchConfigKey]>,
  ),
) as VoiceLabConfig;

export function isFieldVisible(fieldConfig: LaunchConfigField, config: Pick<VoiceLabConfig, LaunchConfigKey>): boolean {
  if (!fieldConfig.showWhen) return true;
  const conditions = (
    Array.isArray(fieldConfig.showWhen) ? fieldConfig.showWhen : [fieldConfig.showWhen]
  ) as readonly ShowWhenCondition[];
  return conditions.every((condition) => {
    const actual = config[condition.key];
    const expected = (Array.isArray(condition.equals) ? condition.equals : [condition.equals]) as readonly unknown[];
    return expected.includes(actual);
  });
}

export function isNullableConfigKey(key: LaunchConfigKey): boolean {
  return NULLABLE_CONFIG_KEYS.includes(key);
}
