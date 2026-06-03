/**
 * terminalLinks — pure helpers for ⌘-click link/path detection in the terminal.
 *
 * wterm has no link handling, so rather than maintain a fragile per-frame pixel
 * overlay aligned to its repainting grid, LiveTerminalScreen resolves the token
 * under the cursor on ⌘-click (via caretPositionFromPoint) and classifies it
 * here. URLs open in the themed browser; file paths are pasted (quoted) at the
 * prompt (no Electron file-open IPC exists yet — a future `path:open` channel
 * could open them in an editor instead). Pure + unit-testable.
 */

export type LinkKind = "url" | "path" | null;

const LEADING = /^[("'`<\[]+/;
const TRAILING = /[)"'`>\].,;:!?]+$/;

/** Expand to the whitespace-delimited token containing `offset`. */
export function tokenAtOffset(text: string, offset: number): string {
  if (!text) return "";
  const clamped = Math.max(0, Math.min(offset, text.length));
  let start = clamped;
  let end = clamped;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return text.slice(start, end);
}

/** Trim wrapping punctuation that commonly hugs a URL/path in output. */
export function trimToken(raw: string): string {
  return raw.replace(LEADING, "").replace(TRAILING, "");
}

const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;
// Absolute, home, explicit-relative, or a clearly multi-segment path.
const PATH_RE = /^(\/|~\/|\.\.?\/)[^\s]+$|^[\w.\-]+\/[\w./\-]+$/;

/** Classify a raw token; returns the cleaned value + a canonical form to act on. */
export function classifyToken(raw: string): { kind: LinkKind; value: string } {
  const value = trimToken(raw);
  if (!value) return { kind: null, value: "" };
  if (URL_RE.test(value)) {
    return { kind: "url", value: value.startsWith("www.") ? `https://${value}` : value };
  }
  if (PATH_RE.test(value)) return { kind: "path", value };
  return { kind: null, value };
}
