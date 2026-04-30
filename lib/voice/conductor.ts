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
 * Naive regex matching any candidate phrase boundary. Kept exported for
 * callers that want a quick "could this be a boundary?" test, but the real
 * splitter (`createPhraseSplitter`) walks the text and rejects false
 * positives like abbreviations ("Dr."), decimals ("v2.0"), and short
 * leading clauses ("First,"). Don't use this regex for real splitting.
 */
export const PHRASE_ENDINGS = /[.!?。]\s+|\n\n|[,;:]\s+/;

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "rev", "hon",
  "capt", "col", "sgt", "lt", "gen", "pres", "sen", "rep",
  "etc", "eg", "ie", "vs", "viz", "cf", "et", "al",
  "am", "pm",
  "no", "vol", "ed", "fig", "approx", "min", "max",
  "inc", "ltd", "co", "corp",
]);

const MIN_SOFT_SPLIT_CHARS = 25;

function isAbbreviationPeriod(text: string, periodIdx: number): boolean {
  // Decimal: "3.14", "v2.0".
  const before = text.charAt(periodIdx - 1);
  const after = text.charAt(periodIdx + 1);
  if (/\d/.test(before) && /\d/.test(after)) return true;

  // Multi-letter dot pattern: "U.S.", "a.m." — char two-before is also a
  // period preceded by a letter, so this whole run is an abbreviation.
  if (
    text.charAt(periodIdx - 2) === "." &&
    /[A-Za-z]/.test(text.charAt(periodIdx - 3))
  ) {
    return true;
  }

  // Walk back over contiguous letters to find the word that owns this period.
  let start = periodIdx;
  while (start > 0 && /[A-Za-z]/.test(text.charAt(start - 1))) start--;
  const word = text.slice(start, periodIdx);
  if (!word) return false;

  // Single capital letter — initial like "A. Lincoln". Treat as abbrev.
  if (word.length === 1 && /[A-Z]/.test(word)) return true;

  return ABBREVIATIONS.has(word.toLowerCase());
}

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

  function emit(out: string[], cutOff: number) {
    const phrase = buf.slice(0, cutOff).trim();
    if (phrase) out.push(phrase);
    buf = buf.slice(cutOff);
  }

  return {
    push(chunk: string): string[] {
      buf += chunk;
      const out: string[] = [];

      // Walk forward; on each potential boundary, decide whether to emit.
      // We restart from index 0 after every emit because `buf` is sliced.
      let i = 0;
      while (i < buf.length) {
        const ch = buf.charAt(i);
        const next = buf.charAt(i + 1);

        // Hard sentence terminator followed by whitespace.
        if (
          (ch === "." || ch === "!" || ch === "?" || ch === "。") &&
          /\s/.test(next)
        ) {
          if (ch === "." && isAbbreviationPeriod(buf, i)) {
            i++;
            continue;
          }
          emit(out, i + 2);
          i = 0;
          continue;
        }

        // Paragraph break.
        if (ch === "\n" && next === "\n") {
          emit(out, i + 2);
          i = 0;
          continue;
        }

        // Soft break (comma / semicolon / colon) — only if accumulated
        // phrase is long enough, so leading clauses like "First," don't
        // get spoken on their own.
        if (
          (ch === "," || ch === ";" || ch === ":") &&
          /\s/.test(next) &&
          i >= MIN_SOFT_SPLIT_CHARS
        ) {
          emit(out, i + 2);
          i = 0;
          continue;
        }

        i++;
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
