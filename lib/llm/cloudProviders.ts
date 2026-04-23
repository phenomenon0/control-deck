/**
 * Paid cloud-provider registry + dispatchers.
 *
 * Routes messages to a user-pinned { provider, model } pair. Unlike the
 * free-tier roulette, there's no quota tracking and no fallback — if
 * the pinned provider 429's, the user sees it. Policy: predictable
 * cost/quality > auto-degrade.
 *
 * Each dispatcher takes a unified input shape (prepared by
 * `prepareForModel` in systemPrompt.ts — so the Claude separate-system
 * field, OpenAI-compat role:"system" message, and o1/o3 inlined
 * Instructions: variants are all handled before we get here) and
 * returns a Response suitable for streaming.
 *
 * v1 ships OpenAI + Anthropic. Google's content-shape is different
 * enough to deserve its own effort; the id is in the type union so
 * UI code can render it as "coming soon."
 */

export type CloudProviderId = "anthropic" | "openai" | "google";

export interface CloudModel {
  id: string;
  displayName: string;
  contextWindow: number;
  modality: "text" | "multimodal" | "reasoning";
  note?: string;
}

export interface CloudProvider {
  id: CloudProviderId;
  name: string;
  envKey: string;
  models: ReadonlyArray<CloudModel>;
  /** False for providers with a dispatcher not yet wired. */
  implemented: boolean;
}

export const CLOUD_PROVIDERS: ReadonlyArray<CloudProvider> = [
  {
    id: "anthropic",
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    implemented: true,
    models: [
      { id: "claude-opus-4-7", displayName: "Claude Opus 4.7", contextWindow: 1_000_000, modality: "multimodal" },
      { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", contextWindow: 1_000_000, modality: "multimodal" },
      { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", contextWindow: 200_000, modality: "multimodal" },
      { id: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet", contextWindow: 200_000, modality: "multimodal" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    implemented: true,
    models: [
      { id: "gpt-4o", displayName: "GPT-4o", contextWindow: 128_000, modality: "multimodal" },
      { id: "gpt-4o-mini", displayName: "GPT-4o mini", contextWindow: 128_000, modality: "multimodal" },
      { id: "gpt-4.1", displayName: "GPT-4.1", contextWindow: 1_000_000, modality: "multimodal" },
      { id: "gpt-4.1-mini", displayName: "GPT-4.1 mini", contextWindow: 1_000_000, modality: "multimodal" },
      { id: "o1", displayName: "o1", contextWindow: 200_000, modality: "reasoning", note: "no system prompt" },
      { id: "o1-mini", displayName: "o1-mini", contextWindow: 128_000, modality: "reasoning", note: "no system prompt" },
      { id: "o3", displayName: "o3", contextWindow: 200_000, modality: "reasoning", note: "no system prompt" },
      { id: "o3-mini", displayName: "o3-mini", contextWindow: 200_000, modality: "reasoning", note: "no system prompt" },
    ],
  },
  {
    id: "google",
    name: "Google",
    envKey: "GOOGLE_API_KEY",
    implemented: true,
    models: [
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", contextWindow: 2_000_000, modality: "multimodal" },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", contextWindow: 1_000_000, modality: "multimodal" },
      { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", contextWindow: 1_000_000, modality: "multimodal" },
      { id: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro", contextWindow: 2_000_000, modality: "multimodal" },
    ],
  },
];

export function findProvider(id: string): CloudProvider | undefined {
  return CLOUD_PROVIDERS.find((p) => p.id === id);
}

// ---- Dispatch shapes --------------------------------------------------

export interface DispatchArgs {
  model: string;
  /** Prepared messages — system already placed per `prepareForModel`. */
  messages: Array<{ role: string; content: string }>;
  /** Provider-separate system field (Claude). Null for others. */
  system: string | null;
  signal?: AbortSignal;
}

export interface StreamEvent {
  delta?: string;
  inputTokens?: number;
  outputTokens?: number;
  done?: boolean;
}

// ---- OpenAI -----------------------------------------------------------

export async function dispatchOpenAI(args: DispatchArgs): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const body: Record<string, unknown> = {
    model: args.model,
    messages: args.messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });
}

/**
 * OpenAI SSE format: one JSON object per `data:` line,
 * final line `data: [DONE]`.
 */
export function parseOpenAILine(line: string): StreamEvent | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") return { done: true };
  try {
    const chunk = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const ev: StreamEvent = {};
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) ev.delta = delta;
    if (chunk.usage) {
      ev.inputTokens = chunk.usage.prompt_tokens;
      ev.outputTokens = chunk.usage.completion_tokens;
    }
    return ev;
  } catch {
    return null;
  }
}

// ---- Anthropic --------------------------------------------------------

export async function dispatchAnthropic(args: DispatchArgs): Promise<Response> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  // Anthropic expects system as a top-level string, not a role message.
  // It also requires max_tokens — use a generous default.
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: 4096,
    messages: args.messages.filter((m) => m.role === "user" || m.role === "assistant"),
    stream: true,
  };
  if (args.system) body.system = args.system;
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });
}

/**
 * Anthropic SSE format: `event: name\n` followed by `data: {...}\n\n`.
 * We parse per-line; the caller feeds us stripped lines so we only see
 * data lines here. Relevant events: content_block_delta (incremental
 * text), message_delta (usage info), message_stop (terminal).
 */
export function parseAnthropicLine(line: string): StreamEvent | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload) return null;
  try {
    const chunk = JSON.parse(payload) as {
      type?: string;
      delta?: { type?: string; text?: string; stop_reason?: string | null };
      usage?: { input_tokens?: number; output_tokens?: number };
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
    };
    const ev: StreamEvent = {};
    if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
      ev.delta = chunk.delta.text;
    }
    if (chunk.type === "message_start" && chunk.message?.usage) {
      ev.inputTokens = chunk.message.usage.input_tokens;
    }
    if (chunk.type === "message_delta" && chunk.usage) {
      ev.outputTokens = chunk.usage.output_tokens;
    }
    if (chunk.type === "message_stop") ev.done = true;
    return ev;
  } catch {
    return null;
  }
}

// ---- Google Gemini ----------------------------------------------------

/**
 * Gemini's content shape differs from everyone else's:
 *   - Role values are "user" and "model" (not "assistant").
 *   - Messages are `contents: [{ role, parts: [{ text }] }]`.
 *   - System prompt goes in `systemInstruction.parts[0].text`.
 *   - Auth is a `?key=` query param or `x-goog-api-key` header.
 *   - Streaming endpoint returns SSE when `?alt=sse` is appended.
 */
export async function dispatchGoogle(args: DispatchArgs): Promise<Response> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY not set");

  // Translate OpenAI-compat messages → Gemini contents. Strip any
  // residual role:"system" (we already extracted it into args.system).
  const contents = args.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: 4096 },
  };
  if (args.system) {
    body.systemInstruction = { parts: [{ text: args.system }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    args.model,
  )}:streamGenerateContent?alt=sse`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });
}

/**
 * Gemini SSE: each `data:` payload is a JSON candidates-envelope.
 * Text is at `candidates[0].content.parts[*].text`, token counts
 * ride along in `usageMetadata`. No [DONE] sentinel — stream just
 * ends when the server closes.
 */
export function parseGoogleLine(line: string): StreamEvent | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload) return null;
  try {
    const chunk = JSON.parse(payload) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const ev: StreamEvent = {};
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    const delta = parts.map((p) => p.text ?? "").join("");
    if (delta) ev.delta = delta;
    if (chunk.usageMetadata) {
      ev.inputTokens = chunk.usageMetadata.promptTokenCount;
      ev.outputTokens = chunk.usageMetadata.candidatesTokenCount;
    }
    if (chunk.candidates?.[0]?.finishReason) ev.done = true;
    return ev;
  } catch {
    return null;
  }
}

// ---- Unified dispatcher ----------------------------------------------

export async function dispatchCloud(
  provider: CloudProviderId,
  args: DispatchArgs,
): Promise<{ response: Response; parse: (line: string) => StreamEvent | null }> {
  switch (provider) {
    case "openai":
      return { response: await dispatchOpenAI(args), parse: parseOpenAILine };
    case "anthropic":
      return { response: await dispatchAnthropic(args), parse: parseAnthropicLine };
    case "google":
      return { response: await dispatchGoogle(args), parse: parseGoogleLine };
  }
}
