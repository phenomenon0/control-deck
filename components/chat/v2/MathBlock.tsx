"use client";

/**
 * MathBlock (v2) — renders LaTeX with KaTeX (safe by design: parses to DOM/HTML,
 * no code execution). Lazy-imports katex; ships the katex stylesheet. Inline or
 * display (block) mode.
 */

import { useEffect, useState } from "react";
import "katex/dist/katex.min.css";

export interface MathBlockProps {
  tex: string;
  block?: boolean;
}

export function MathBlock({ tex, block = false }: MathBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const katex = (await import("katex")).default;
      const out = katex.renderToString(tex, { displayMode: block, throwOnError: false });
      if (!cancelled) setHtml(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [tex, block]);

  if (html == null) return <code>{tex}</code>;
  // KaTeX output is trusted (no arbitrary HTML/JS).
  return (
    <span
      className="cd-math"
      data-testid="math-block"
      style={{ display: block ? "block" : "inline", color: "var(--text-primary)" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default MathBlock;
