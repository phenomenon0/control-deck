const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeMarkdownHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;

  try {
    const url = new URL(value);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
