"use client";

/**
 * RichText (Atlas v2) — the rich chat renderer for assistant prose.
 *
 * Ported from the parallel deck's RichText and folded together with its math /
 * code / table pieces, then token-remapped to the Atlas paper-klein surface.
 * Built on the already-installed `marked` (^18) with three additions:
 *
 *   1. **Math** — inline `$…$` and display `$$…$$` render via KaTeX
 *      (`renderToString`, `throwOnError:false`). KaTeX parses to trusted HTML,
 *      no code execution; the katex stylesheet ships alongside.
 *   2. **Safe HTML** — chat content is untrusted (LLM + user), so the assembled
 *      HTML is run through DOMPurify before injection. That lets real HTML
 *      (`<table>`, `<b>`, …) render instead of being escaped, while blocking XSS.
 *   3. **Fenced blocks** — code blocks keep their language on `data-lang` so the
 *      Atlas `.av2 pre[data-lang]` chrome (language eyebrow) styles them. Heavy
 *      diagram fences (```mermaid / ```vega / ```chart) are NOT rendered live
 *      (mermaid/vega are too heavy to ship here) — they gracefully degrade to a
 *      labelled source block plus a "preview unavailable" note.
 *
 * Emits standard markdown tags (p / strong / em / code / pre / ul / ol / li /
 * blockquote / a / table / h1–6). Shared prose elements are styled by the
 * existing `.av2 .a` rules in atlas-v2.css (so plain prose is unchanged); the
 * elements those rules don't cover (headings, tables, math, the diagram note)
 * are styled by richtext.css, token-driven off the Atlas vars.
 */

import { useMemo } from "react";
import { Marked, type Tokens, type TokenizerAndRendererExtension } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import "./richtext.css";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;
const SAFE_IMG = /^(https?:|data:image\/)/i;
// Fences we deliberately do NOT render live (mermaid/vega are too heavy for this
// bundle). They degrade to a labelled source block + a note — never a crash.
const DIAGRAM_LANGS = new Set(["mermaid", "vega", "vega-lite", "vegalite", "chart"]);

function renderMath(tex: string, block: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: block, throwOnError: false });
  } catch {
    const d = block ? "$$" : "$";
    return `<code>${escapeHtml(d + tex + d)}</code>`;
  }
}

/** Inline math: display `$$…$$` (embedded) first, then inline `$…$`. Standalone
 *  `$$…$$` blocks are handled by the block extension for proper block spacing. */
const inlineMath: TokenizerAndRendererExtension = {
  name: "inlineMath",
  level: "inline",
  start(src: string) {
    const i = src.indexOf("$");
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const disp = /^\$\$((?:\\.|[^$\\])+?)\$\$/.exec(src);
    if (disp) return { type: "inlineMath", raw: disp[0], text: disp[1].trim(), display: true };
    const inl = /^\$(?!\$)((?:\\.|[^$\\\n])+?)\$(?!\$)/.exec(src);
    if (inl) return { type: "inlineMath", raw: inl[0], text: inl[1].trim(), display: false };
    return undefined;
  },
  renderer(token) {
    return renderMath(token.text as string, Boolean((token as { display?: boolean }).display));
  },
};

/** Standalone display math block: `$$ … $$` on its own line(s). */
const blockMath: TokenizerAndRendererExtension = {
  name: "blockMath",
  level: "block",
  start(src: string) {
    const i = src.indexOf("$$");
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = /^\$\$\s*([\s\S]+?)\s*\$\$(?:\n+|$)/.exec(src);
    if (m) return { type: "blockMath", raw: m[0], text: m[1].trim() };
    return undefined;
  },
  renderer(token) {
    return renderMath(token.text as string, true);
  },
};

const md = new Marked({ gfm: true, breaks: true });
md.use({
  extensions: [inlineMath, blockMath],
  renderer: {
    // Restrict link protocols (drop javascript:/data:, etc.); open safe links
    // in a new tab. DOMPurify keeps target via the ADD_ATTR config below.
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      const href = (token.href ?? "").trim();
      if (!SAFE_HREF.test(href)) return inner;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
    // Only http(s) and data:image — anything else falls back to alt text.
    image(token: Tokens.Image) {
      const href = (token.href ?? "").trim();
      const alt = escapeHtml(token.text ?? "");
      if (!SAFE_IMG.test(href)) return alt;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${alt}"${title} loading="lazy" />`;
    },
    // Keep the language on data-lang so the Atlas pre chrome labels it. Diagram
    // fences degrade to a labelled source block + a preview-unavailable note.
    code(token: Tokens.Code) {
      const lang = (token.lang ?? "").trim().split(/\s+/)[0];
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
      const body = `<pre${langAttr}><code>${escapeHtml(token.text)}</code></pre>`;
      if (lang && DIAGRAM_LANGS.has(lang.toLowerCase())) {
        return `${body}<div class="rt-diagram-note">diagram preview unavailable — showing ${escapeHtml(lang)} source</div>`;
      }
      return body;
    },
  },
});

export interface RichTextProps {
  /** Markdown source. */
  content: string;
  className?: string;
}

export function RichText({ content, className }: RichTextProps) {
  const html = useMemo(() => {
    const raw = md.parse(content, { async: false }) as string;
    // Untrusted content → sanitize. KaTeX/MathML + benign inline styles survive;
    // target on links is re-allowed so safe links still open in a new tab. On
    // the server DOMPurify has no DOM and passes through (chat content only ever
    // renders client-side, from localStorage-backed state).
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  }, [content]);

  return (
    <div
      className={`rt-prose${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Chat call interface — kept identical so existing `<Markdown content={…} />`
 *  sites need no change. */
export function Markdown({ content }: { content: string }) {
  if (!content) return null;
  return <RichText content={content} />;
}

export default Markdown;
