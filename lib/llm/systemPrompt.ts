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
