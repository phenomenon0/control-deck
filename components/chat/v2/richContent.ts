/**
 * richContent — classify agent output into the right v2 renderer. Tool results
 * arrive as DeckPayload (json/text) and fenced blocks carry a language; this maps
 * them to table | chart | mermaid | math | html | code so ChatSegments / RichText
 * can pick a renderer instead of dumping raw JSON.
 */

export type RichKind = "table" | "chart" | "mermaid" | "math" | "html" | "code" | "image";

export interface RichClassification {
  kind: RichKind;
  /** Parsed payload for the renderer (rows for table, spec for chart, etc.). */
  data?: unknown;
}

/** Is this a Vega/Vega-Lite spec? */
function isVegaSpec(v: Record<string, unknown>): boolean {
  const schema = typeof v.$schema === "string" ? v.$schema : "";
  if (/vega/i.test(schema)) return true;
  return "mark" in v && "encoding" in v;
}

/** Classify a structured value (e.g. a decoded DeckPayload `data`). */
export function classifyData(value: unknown): RichClassification | null {
  if (Array.isArray(value) && value.length > 0 && value.every((r) => r != null && typeof r === "object" && !Array.isArray(r))) {
    return { kind: "table", data: value };
  }
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (isVegaSpec(obj)) return { kind: "chart", data: obj };
    // { columns, rows } table shape
    if (Array.isArray(obj.rows)) return { kind: "table", data: obj.rows };
  }
  return null;
}

/** Classify a fenced code block by its info-string language. */
export function classifyFence(language: string | undefined, code: string): RichClassification {
  const lang = (language ?? "").toLowerCase().trim();
  if (lang === "mermaid") return { kind: "mermaid", data: code };
  if (lang === "math" || lang === "latex" || lang === "tex") return { kind: "math", data: code };
  if (lang === "html") return { kind: "html", data: code };
  if (lang === "vega" || lang === "vega-lite" || lang === "vegalite") {
    try {
      return { kind: "chart", data: JSON.parse(code) };
    } catch {
      return { kind: "code", data: code };
    }
  }
  // bare json that happens to be a vega spec or table
  if (lang === "json" || lang === "") {
    try {
      const parsed = JSON.parse(code);
      const c = classifyData(parsed);
      if (c) return c;
    } catch {
      /* not json */
    }
  }
  return { kind: "code", data: code };
}
