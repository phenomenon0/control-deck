/**
 * Minimal YAML frontmatter parser. Skills carry at most a handful of keys
 * (name/description/tags/tools/model/version) — we don't need a full YAML
 * parser, just tolerant line-by-line extraction that handles strings,
 * quoted strings, and inline arrays `[a, b, c]`.
 *
 * If the file has no frontmatter block it returns `{ data: {}, body: raw }`.
 */

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONT_MATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function parseFrontmatter(source: string): Frontmatter {
  const match = source.match(FRONT_MATTER_RE);
  if (!match) {
    return { data: {}, body: source };
  }
  const head = match[1];
  const body = source.slice(match[0].length);
  const data: Record<string, unknown> = {};

  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const rawValue = trimmed.slice(colon + 1).trim();
    data[key] = parseValue(rawValue);
  }
  return { data, body };
}

function parseValue(raw: string): unknown {
  if (raw === "") return "";
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Inline array — tolerant: strip brackets, split on comma, trim quotes.
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => {
      const v = s.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
      }
      return v;
    });
  }
  // Boolean / null
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  // Number
  const n = Number(raw);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(raw)) return n;
  return raw;
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${serializeValue(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n") + body.replace(/^\n+/, "");
}

function serializeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")}]`;
  }
  if (typeof value === "string") {
    // Quote only if ambiguous (contains colon, leading hash, etc.)
    if (/[:#\[\]]/.test(value)) return JSON.stringify(value);
    return value;
  }
  return JSON.stringify(value);
}
