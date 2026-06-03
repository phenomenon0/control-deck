"use client";

/**
 * HtmlPreview (v2) — renders agent-generated HTML in a SANDBOXED iframe. The
 * iframe `sandbox="allow-scripts"` (note: NO allow-same-origin) is the security
 * boundary — scripts run but can't reach the parent, cookies, or storage — so we
 * render the raw doc via srcDoc rather than stripping scripts (which would kill
 * interactive demos). For SVG injected into the MAIN dom we sanitize instead
 * (see MermaidBlock). Used for design/preview review + "open in canvas".
 */

import { SquarePen } from "lucide-react";

export interface HtmlPreviewProps {
  html: string;
  height?: number;
  title?: string;
  onOpenCanvas?: (html: string) => void;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function HtmlPreview({ html, height = 280, title = "preview", onOpenCanvas }: HtmlPreviewProps) {
  return (
    <div className="cd-html overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
      <div className="flex items-center gap-2 border-b px-2.5 py-1" style={{ borderColor: "var(--border-subtle)" }}>
        <span className="text-[var(--text-muted)]" style={MONO}>{title}</span>
        {onOpenCanvas && (
          <button type="button" onClick={() => onOpenCanvas(html)} className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]" style={MONO}>
            <SquarePen size={12} /> canvas
          </button>
        )}
      </div>
      <iframe
        // Sandbox WITHOUT allow-same-origin = isolated origin; safe for untrusted HTML/JS.
        sandbox="allow-scripts"
        srcDoc={html}
        title={title}
        className="block w-full border-0 bg-white"
        style={{ height }}
      />
    </div>
  );
}

export default HtmlPreview;
