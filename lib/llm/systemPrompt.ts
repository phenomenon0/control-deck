/**
 * System-prompt plumbing shared across the three chat routes
 * (Agent-GO, free-tier, simple/Ollama).
 *
 * Two responsibilities:
 *   1. A vetted default prompt that anchors language + brevity + tool use
 *      — so fresh installs aren't at the mercy of each model's training
 *      quirks (the notorious Nemotron-speaks-Chinese-at-random problem).
 *   2. Model-family augmentation that invisibly layers provider-specific
 *      fixes on top of the user's base prompt. Multilingual models get
 *      an explicit English anchor; reasoning models get a focus nudge.
 *
 * Keep additions here minimal and load-bearing. This file is a
 * centralised place for prompt-tuning knowledge that used to be
 * scattered across per-route config and per-model docs.
 */

export const DEFAULT_SYSTEM_PROMPT = [
  "Respond in English unless the user writes in another language.",
  "Be concise. Prefer short direct answers over long explanations.",
  "When tools are available, call them instead of describing what you would do.",
  "If unsure, ask one clarifying question rather than guessing.",
].join("\n");

/**
 * Model-family patterns that drift to Chinese or other non-English
 * output without an explicit language anchor. Substring match on the
 * lowercased model id. Err on the side of inclusion — the anchor is
 * redundant-safe (a model that already answers in English ignores it).
 */
const MULTILINGUAL_DRIFTERS: ReadonlyArray<string> = [
  "qwen",
  "deepseek",
  "minimax",
  "tencent",
  "nemotron",
  "nvidia",
  "hunyuan",
  "hy3-",
  "yi-",
  "glm",
  "baidu",
  "inclusionai",
  "zhipu",
];

/**
 * Model-family patterns for reasoning/thinking models where a concise
 * instruction ("don't spiral") noticeably improves output quality.
 */
const REASONING_FAMILIES: ReadonlyArray<string> = [
  "r1",
  "nemotron-super",
  "deepseek-v3.2",
  "gpt-oss",
  "thinking",
];

/**
 * Apply family-aware nudges on top of the user's base prompt. Returns
 * the final system-prompt string to prepend to the messages array.
 */
export function augmentForModel(basePrompt: string, modelId: string): string {
  const id = (modelId || "").toLowerCase();
  const parts: string[] = [];

  // Language anchor first — drift happens before anything else.
  if (MULTILINGUAL_DRIFTERS.some((p) => id.includes(p))) {
    parts.push("Respond in English unless the user explicitly writes in another language.");
  }

  // Reasoning focus.
  if (REASONING_FAMILIES.some((p) => id.includes(p))) {
    parts.push("Keep reasoning focused; don't over-explore alternatives unless asked.");
  }

  const trimmed = (basePrompt || "").trim();
  if (trimmed) parts.push(trimmed);

  return parts.join("\n\n");
}

/**
 * Prepend or merge a system message into a messages array.
 *   - If the array is empty or starts with a non-system role: prepend
 *     a new `{role:"system"}` entry.
 *   - If it already starts with a system message (unusual — probably
 *     means the client or tool-bridge already inserted one): merge by
 *     concatenation, preserving both instructions.
 *   - Empty/whitespace-only system content is a no-op.
 */
export function withSystemPrompt<M extends { role: string; content: string }>(
  messages: ReadonlyArray<M>,
  systemContent: string,
): M[] {
  const trimmed = (systemContent || "").trim();
  if (!trimmed) return [...messages];

  if (messages[0]?.role === "system") {
    const merged = { ...messages[0], content: `${trimmed}\n\n${messages[0].content}` };
    return [merged, ...messages.slice(1)] as M[];
  }

  const head = { role: "system", content: trimmed } as M;
  return [head, ...messages] as M[];
}

/**
 * Shape of a request after system-prompt preparation. Split into the
 * provider-agnostic `messages` array (what goes into the body) and an
 * optional `system` string (what goes into a separate API field for
 * providers that prefer it — Anthropic Claude, Google Gemini).
 */
export interface PreparedMessages<M extends { role: string; content: string }> {
  /** Non-null when the provider wants the system prompt as a separate field. */
  system: string | null;
  /**
   * Messages to send in the request body. Includes a `role:"system"`
   * entry for OpenAI-compatible providers; omits it for providers that
   * consume `system` separately; inlines it into the first user message
   * for providers that don't accept system prompts at all (o1/o3).
   */
  messages: M[];
}

/** Providers that consume `system` as a separate API field, not a message role. */
function wantsSeparateSystemField(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.startsWith("anthropic/") || id.includes("claude")) return true;
  if (id.startsWith("google/") || id.includes("gemini")) return true;
  return false;
}

/** Providers that don't accept system prompts at all (OpenAI reasoning models). */
function noSystemPromptSupport(modelId: string): boolean {
  const id = modelId.toLowerCase();
  // Catches openai/o1, openai/o1-mini, openai/o3, openai/o3-mini, openai/o4
  return /(^|\/)o[134](\b|-)/.test(id);
}

/**
 * Final assembly step. Handles three provider classes:
 *   1. OpenAI-compatible (default) — prepend `role:"system"` message.
 *   2. Separate system field (Claude, Gemini) — return system string,
 *      messages unmodified.
 *   3. No-system-prompt (OpenAI o1/o3) — inline the content into the
 *      first user message as "Instructions: ...\n\n{original}".
 *
 * Callers pass the raw base prompt; augmentForModel is invoked inside
 * so family-aware nudges are applied automatically.
 */
export function prepareForModel<M extends { role: string; content: string }>(
  messages: ReadonlyArray<M>,
  baseSystemPrompt: string,
  modelId: string,
): PreparedMessages<M> {
  const augmented = augmentForModel(baseSystemPrompt || "", modelId).trim();
  if (!augmented) {
    return { system: null, messages: [...messages] };
  }

  if (wantsSeparateSystemField(modelId)) {
    return { system: augmented, messages: [...messages] };
  }

  if (noSystemPromptSupport(modelId)) {
    // Relocate system content into the first user message. Preserves any
    // prior role:"system" entries (they get concatenated into the
    // preamble too — rare but robust).
    const cloned = [...messages] as M[];
    const firstUserIdx = cloned.findIndex((m) => m.role === "user");
    if (firstUserIdx === -1) {
      // No user message yet — synthesize one carrying the instructions.
      cloned.unshift({ role: "user", content: `Instructions:\n${augmented}` } as M);
      return { system: null, messages: cloned };
    }
    const target = cloned[firstUserIdx];
    cloned[firstUserIdx] = {
      ...target,
      content: `Instructions:\n${augmented}\n\n${target.content}`,
    } as M;
    return { system: null, messages: cloned };
  }

  // OpenAI-compatible (Ollama, OpenRouter, NVIDIA NIM, OpenAI chat
  // completions, most everything else) — use the role:"system" shape.
  return { system: null, messages: withSystemPrompt(messages, augmented) };
}
