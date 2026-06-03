"use client";

/**
 * RichText (v2 rebuild) — lean markdown renderer for chat content.
 *
 * Reuses the already-installed `marked` (^18). Two safety overrides on top of
 * the default renderer, because chat content is untrusted (LLM + user) and
 * marked v18 emits raw HTML and arbitrary link protocols by default:
 *   1. raw HTML tokens are escaped to text (never injected), and
 *   2. link hrefs are restricted to http(s)/mailto/anchor/relative.
 * That keeps us dependency-free (no DOMPurify) while staying XSS-safe.
 *
 * Constrained subset only (headings, lists, code, links, emphasis, quotes) —
 * styling lives in RichText.css, token-driven and flat.
 */

import { useMemo } from "react";
import { Marked, type Tokens } from "marked";

import "./RichText.css";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;
const SAFE_IMG = /^(https?:|data:image\/)/i;

const md = new Marked({ gfm: true, breaks: true });
md.use({
  renderer: {
    // Neutralize raw HTML: render it as visible text, never as markup.
    html(this: { parser: unknown }, token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    // Drop unsafe link protocols (javascript:, data:, etc.); keep the text.
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      const href = (token.href ?? "").trim();
      if (!SAFE_HREF.test(href)) return inner;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
    // Images: only http(s) and data:image — anything else falls back to alt text.
    image(token: Tokens.Image) {
      const href = (token.href ?? "").trim();
      const alt = escapeHtml(token.text ?? "");
      if (!SAFE_IMG.test(href)) return alt;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${alt}"${title} loading="lazy" />`;
    },
  },
});

export interface RichTextProps {
  /** Markdown source. */
  content: string;
  className?: string;
}

export function RichText({ content, className }: RichTextProps) {
  const html = useMemo(() => md.parse(content, { async: false }) as string, [content]);
  return (
    <div
      className={`rt-prose${className ? ` ${className}` : ""}`}
      // Safe: raw HTML is escaped and link protocols are restricted in the
      // renderer overrides above before this string is produced.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default RichText;
