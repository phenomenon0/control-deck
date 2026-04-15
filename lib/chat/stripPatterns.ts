/**
 * Strip patterns — shared content-cleaning utility (SURFACE.md §4.3)
 *
 * LLM text output often echoes tool-result metadata inline alongside
 * structured SSE events. These patterns remove that machine metadata
 * so the display text is clean and the conversation history sent back
 * to Agent-GO doesn't teach the LLM to fake tool calls.
 *
 * Two exported functions:
 *   stripForDisplay(content)    — used by RichText for rendering
 *   stripForLLMHistory(content) — used by /api/chat for history sanitisation
 */

/** Tool JSON blocks the LLM sometimes wraps in markdown fences or emits raw */
const TOOL_JSON: RegExp[] = [
  /```json\s*\n?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?\s*```/g,
  /\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g,
];

/** Markdown image syntax — the LLM should use ArtifactCreated events, not ![](url) */
const MARKDOWN_IMAGES: RegExp[] = [
  /!\[[^\]]*\]\([^)]+\)/g,
];

/** Status/progress messages the LLM echoes from tool execution */
const EXECUTION_STATUS: RegExp[] = [
  /\[Executing [^\]]+\.\.\.\]\n*/g,
  /Code executed successfully.*?\n/g,
  /Code execution failed.*?\n/g,
  /Preview generated for.*?\n/g,
];

/** Artifact/generation success messages the LLM echoes after tool results */
const GENERATION_MESSAGES: RegExp[] = [
  /\[Image:[^\]]+\]\s*\(image_id:[^)]+\)\n*/g,
  /Image generated:.*?\(prompt_id:.*?\).*?(?:\.|$)\s*/g,
  /Generated image:.*?\(queued, prompt_id:.*?\).*?(?:\n|$)/g,
  /Generated \d+s? audio:.*?(?:\n|$)/g,
  /Edited image:.*?(?:\n|$)/g,
  /Generated 3D model.*?(?:\n|$)/g,
  /Generated.*?glyph.*?(?:\n|$)/gi,
];

/** Instructional / confirmatory messages from tool results */
const INSTRUCTIONAL: RegExp[] = [
  /Use `show_image` with this ID to view\.?\s*/g,
  /Quick generation.*?SDXL Turbo\.?\s*/g,
  /Success\.?\s*Artifact displayed in chat\.?\s*/gi,
  /Artifact displayed\.?\s*/gi,
  /Here(?:'s| is) the (?:audio|image|model|artifact)\.?\s*/gi,
];

/** Output/error code blocks from tool execution results */
const EXECUTION_OUTPUT: RegExp[] = [
  /\n?Output:\n```[\s\S]*?```/g,
  /\n?Errors:\n```[\s\S]*?```/g,
];

/** Artifact IDs and filenames that leak into text */
const ARTIFACT_IDS: RegExp[] = [
  /img_\d+-\d+/g,
  /audio_\d+-\d+/g,
  /deck_(?:turbo|img|audio)_\d+_?\.(?:png|jpg|mp3|wav)/gi,
];

/** Orphaned file references in parentheses */
const ORPHANED_REFS: RegExp[] = [
  /\([^)]*\.(?:png|jpg|jpeg|gif|mp3|wav)\)/gi,
];

/** Fake success phrases the LLM produces instead of calling tools */
const FAKE_SUCCESS: RegExp[] = [
  /Here is (?:an?|the) (?:image|picture|photo)[^.]*\.?/gi,
  /I(?:'ve| have) generated[^.]*\.?/gi,
  /Generated (?:an?|the) (?:image|picture)[^.]*\.?/gi,
];

function collapseWhitespace(s: string): string {
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function applyPatterns(content: string, patterns: RegExp[]): string {
  let clean = content;
  for (const pattern of patterns) {
    // Create a fresh RegExp from source+flags so lastIndex is always 0
    clean = clean.replace(new RegExp(pattern.source, pattern.flags), "");
  }
  return clean;
}

/**
 * Strip machine metadata from LLM text for display in the timeline.
 * Removes tool JSON, markdown images, execution status, generation messages,
 * instructional text, execution output blocks, and confirmatory phrases.
 */
export function stripForDisplay(content: string): string {
  const allPatterns = [
    ...TOOL_JSON,
    ...MARKDOWN_IMAGES,
    ...EXECUTION_STATUS,
    ...GENERATION_MESSAGES,
    ...INSTRUCTIONAL,
    ...EXECUTION_OUTPUT,
  ];
  return collapseWhitespace(applyPatterns(content, allPatterns));
}

/**
 * Strip content from assistant messages in conversation history before
 * sending to Agent-GO. Removes patterns that might teach the LLM to
 * fake tool calls or reference artifacts by ID instead of using tools.
 */
export function stripForLLMHistory(content: string): string {
  const allPatterns = [
    ...MARKDOWN_IMAGES,
    ...FAKE_SUCCESS,
    ...ARTIFACT_IDS,
    ...ORPHANED_REFS,
  ];
  return collapseWhitespace(applyPatterns(content, allPatterns));
}
