/**
 * Derive a modality grouping for each tool from its name.
 *
 * TOOL_DEFINITIONS doesn't carry an explicit modality field today; rather
 * than retrofit every schema, we pattern-match on the canonical tool name.
 * When a new tool lands without an obvious prefix it falls into `other`
 * until someone adds a rule here.
 */

export type ToolModality =
  | "text" // web search, summarise, etc
  | "vision" // analyze_image and friends
  | "image-gen" // generate/edit image, glyph
  | "audio-gen" // sfx / music
  | "tts"
  | "stt"
  | "3d-gen"
  | "video-gen"
  | "embedding" // vector store/search/ingest
  | "code" // execute_code + friends
  | "native" // desktop automation
  | "other";

interface Rule {
  modality: ToolModality;
  test: (name: string) => boolean;
}

const RULES: Rule[] = [
  { modality: "native", test: (n) => n.startsWith("native_") },
  { modality: "embedding", test: (n) => n.startsWith("vector_") },
  { modality: "code", test: (n) => n === "execute_code" || n.startsWith("code_") },
  { modality: "vision", test: (n) => n === "analyze_image" },
  { modality: "image-gen", test: (n) => n === "generate_image" || n === "edit_image" || n === "glyph_motif" },
  { modality: "audio-gen", test: (n) => n === "generate_audio" },
  { modality: "3d-gen", test: (n) => n === "image_to_3d" || n.includes("_3d") },
  { modality: "video-gen", test: (n) => n.includes("video") },
  { modality: "tts", test: (n) => n.includes("tts") || n === "speak" },
  { modality: "stt", test: (n) => n.includes("stt") || n === "transcribe" },
  { modality: "text", test: (n) => n === "web_search" || n.startsWith("search_") || n.startsWith("browse_") },
];

export function modalityForTool(name: string): ToolModality {
  const lower = name.toLowerCase();
  for (const r of RULES) {
    if (r.test(lower)) return r.modality;
  }
  return "other";
}

export const MODALITY_LABEL: Record<ToolModality, string> = {
  text: "Text / web",
  vision: "Vision",
  "image-gen": "Image",
  "audio-gen": "Music/SFX",
  tts: "TTS",
  stt: "STT",
  "3d-gen": "3D",
  "video-gen": "Video",
  embedding: "Embedding",
  code: "Code",
  native: "Native automation",
  other: "Other",
};

/** Render order for grouping UIs. Mirrors the Models pane's modality order where applicable. */
export const MODALITY_ORDER: ToolModality[] = [
  "text",
  "vision",
  "image-gen",
  "audio-gen",
  "tts",
  "stt",
  "3d-gen",
  "video-gen",
  "embedding",
  "code",
  "native",
  "other",
];
