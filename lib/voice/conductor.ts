/**
 * Conductor — pure helpers for the voice turn pipeline.
 *
 * `useVoiceSession.runTurn` uses these to:
 *   - split a streaming LLM response into TTS-friendly phrases as it arrives,
 *   - sanitize text for display vs. for speech (markdown, tool call payloads),
 *   - map agentic tool events into short status messages.
 *
 * Pulled out of `VoiceModeSheet.tsx` so the same logic powers every voice
 * surface (Live tab, fullscreen sheet, future inline mic).
 */

/**
 * Splits on sentence endings *or* commas/semicolons so TTS can start on the
 * first phrase rather than waiting for a full sentence. The first phrase
 * usually arrives within ~200 ms of the LLM's first token.
 */
export const PHRASE_ENDINGS = /[.!?。]\s+|\n\n|[,;:]\s+/;

const TOOL_PAYLOAD = /\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g;
const TOOL_FENCE = /```json\s*\n?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?\s*```/g;
const TOOL_INLINE = /\[Executing [^\]]+\.\.\.\]\n*/g;
const MARKDOWN_IMG = /!\[.*?\]\(.*?\)/g;

const MARKDOWN_BOLD = /\*\*([^*]+)\*\*/g;
const MARKDOWN_ITAL = /\*([^*]+)\*/g;
const MARKDOWN_CODE = /`([^`]+)`/g;
const MARKDOWN_HEADER = /#{1,6}\s*/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const MARKDOWN_FENCE = /```[\s\S]*?```/g;
const PARAGRAPH_BREAK = /\n{2,}/g;

/** Strip tool-call payloads + raw image markdown so the chat bubble stays clean. */
export function cleanResponseForDisplay(text: string): string {
  return text
    .replace(TOOL_INLINE, "")
    .replace(TOOL_FENCE, "")
    .replace(TOOL_PAYLOAD, "")
    .replace(MARKDOWN_IMG, "")
    .trim();
}

/** Strip markdown + tool payloads so the TTS engine doesn't read syntax aloud. */
export function cleanResponseForSpeech(text: string, maxChars = 500): string {
  let clean = cleanResponseForDisplay(text)
    .replace(MARKDOWN_FENCE, "code block")
    .replace(MARKDOWN_BOLD, "$1")
    .replace(MARKDOWN_ITAL, "$1")
    .replace(MARKDOWN_CODE, "$1")
    .replace(MARKDOWN_HEADER, "")
    .replace(MARKDOWN_LINK, "$1")
    .replace(PARAGRAPH_BREAK, ". ")
    .trim();
  if (clean.length < 2) return "";
  return clean.slice(0, maxChars);
}

/** Short status message shown while a tool runs. `null` = render nothing. */
export function getToolStartMessage(toolName: string): string | null {
  switch (toolName) {
    case "generate_image":
      return "Generating image...";
    case "edit_image":
      return "Editing image...";
    case "generate_audio":
      return "Creating audio...";
    case "web_search":
      return "Searching the web...";
    case "image_to_3d":
      return "Creating 3D model...";
    case "analyze_image":
      return "Analyzing image...";
    case "glyph_motif":
      return "Creating glyph...";
    default:
      return null;
  }
}

/**
 * Stateful phrase splitter — feed it incremental chunks; it returns any whole
 * phrases that completed since the last call and keeps the trailing fragment.
 *
 * Usage:
 *   const split = createPhraseSplitter();
 *   for await (const chunk of stream) {
 *     for (const phrase of split.push(chunk)) tts.queue(phrase);
 *   }
 *   const tail = split.flush();
 *   if (tail) tts.queue(tail);
 */
export function createPhraseSplitter() {
  let buf = "";
  return {
    push(chunk: string): string[] {
      buf += chunk;
      const out: string[] = [];
      let match;
      while ((match = buf.match(PHRASE_ENDINGS))) {
        const cutOff = match.index! + match[0].length;
        const phrase = buf.slice(0, cutOff).trim();
        if (phrase) out.push(phrase);
        buf = buf.slice(cutOff);
      }
      return out;
    },
    flush(): string | null {
      const tail = buf.trim();
      buf = "";
      return tail || null;
    },
  };
}
