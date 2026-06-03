"use client";

/**
 * MermaidBlock (v2) — renders a mermaid diagram from agent output. mermaid is
 * lazy-imported and run with `securityLevel:'strict'`; the resulting SVG is
 * sanitized with DOMPurify (svg profile) before injection into the main DOM
 * (the SVG is NOT in an iframe, so sanitization is the boundary here). Re-renders
 * on theme flip (dark/light). Errors caught.
 */

import { useEffect, useRef, useState } from "react";

export interface MermaidBlockProps {
  code: string;
}

let mmdSeq = 0;
const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function MermaidBlock({ code }: MermaidBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => setThemeVersion((v) => v + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const DOMPurify = (await import("dompurify")).default;
        const isLight = document.documentElement.classList.contains("light");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isLight ? "default" : "dark" });
        const { svg } = await mermaid.render(`cd-mmd-${mmdSeq++}`, code);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "diagram error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, themeVersion]);

  if (error) {
    return (
      <div className="rounded-[var(--radius-sm)] border px-2.5 py-2 text-[var(--text-muted)]" style={{ borderColor: "var(--border-subtle)", ...MONO }}>
        diagram error: {error}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="cd-mermaid flex justify-center overflow-x-auto rounded-[var(--radius-sm)] border p-3"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
      data-testid="mermaid-block"
    />
  );
}

export default MermaidBlock;
