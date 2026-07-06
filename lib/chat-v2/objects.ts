import type { Artifact } from "@/lib/types/chat";

/**
 * Canvas object model for chat-v2.
 *
 * An assistant turn can yield renderable objects: executable code blocks (run
 * via the real /api/code/execute path) and artifacts (rendered by the real
 * ArtifactRenderer). Each becomes an inline `.obj` card in the flow and, when
 * opened, fills the Atlas `.canvas__stage`.
 */
export interface CanvasObject {
  id: string;
  source: "code" | "artifact";
  /** Display kind: language ("react") or artifact family ("image"). */
  kind: string;
  title: string;
  meta: string;
  code?: string;
  language?: string;
  artifact?: Artifact;
  /** True when the code block can run through /api/code/execute. */
  executable: boolean;
}

// Languages the code-exec sandbox accepts (mirrors RichText's isExecutable +
// lib/tools/code-exec supported set).
const EXECUTABLE = new Set([
  "python", "javascript", "typescript", "js", "ts",
  "go", "c", "bash", "sh", "lua", "react", "html", "threejs",
]);
// Languages whose run produces a bundled HTML preview (iframe), vs. ones that
// produce stdout/images (python etc.).
const IFRAME_PREVIEW = new Set(["html", "react", "threejs"]);

function normalizeLang(l?: string): string {
  if (!l) return "";
  const x = l.toLowerCase();
  if (x === "js") return "javascript";
  if (x === "ts") return "typescript";
  return x;
}

export function artifactKind(a: Artifact): string {
  const m = a.mimeType || "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.includes("gltf") || m.includes("glb") || a.name.endsWith(".glb") || a.name.endsWith(".gltf")) return "model";
  return "file";
}

/** True when the object renders as a live iframe preview when executed. */
export function hasIframePreview(obj: CanvasObject): boolean {
  return obj.source === "code" && IFRAME_PREVIEW.has(obj.language || "");
}

/**
 * Split an assistant turn into display prose + canvas objects.
 *
 * Executable fenced code blocks are lifted out of the prose (they live in the
 * canvas, referenced by an `.obj` card). Non-executable fences (```json,
 * ```text, un-tagged) stay inline and are rendered as Atlas <pre> by Markdown.
 * Artifacts always become objects.
 */
export function parseAssistant(
  messageId: string,
  content: string,
  artifacts?: Artifact[],
): { prose: string; objects: CanvasObject[] } {
  const objects: CanvasObject[] = [];
  const codeRe = /```(\w*)\n?([\s\S]*?)```/g;
  let prose = "";
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;

  while ((m = codeRe.exec(content)) !== null) {
    const raw = (m[1] || "").toLowerCase();
    if (!EXECUTABLE.has(raw)) continue; // keep non-executable fences in prose

    const lang = normalizeLang(m[1]);
    const code = m[2].replace(/\n$/, "");
    prose += content.slice(last, m.index);
    last = m.index + m[0].length;

    const lines = code.split("\n").length;
    objects.push({
      id: `${messageId}:code:${idx++}`,
      source: "code",
      kind: lang || "code",
      title: `${lang || "code"}_snippet`,
      meta: `${lang || "code"} · ${lines} line${lines === 1 ? "" : "s"}`,
      code,
      language: lang || "text",
      executable: true,
    });
  }
  prose += content.slice(last);

  for (const a of artifacts || []) {
    const kind = artifactKind(a);
    const sub = (a.mimeType || "").split("/").pop() || "";
    objects.push({
      id: `${messageId}:art:${a.id}`,
      source: "artifact",
      kind,
      title: a.name || kind,
      meta: sub ? `${kind} · ${sub}` : kind,
      artifact: a,
      executable: false,
    });
  }

  return { prose: prose.trim(), objects };
}
