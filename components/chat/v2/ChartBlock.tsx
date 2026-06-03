"use client";

/**
 * ChartBlock (v2) — renders a Vega-Lite JSON spec the agent emits (spec-driven,
 * no code execution). Vega-embed is lazy-imported (keeps the base bundle lean),
 * rendered as SVG with `actions:false`. Theming: the Vega `config` is HYDRATED
 * from the deck's CSS vars at render and re-rendered when the theme changes, so
 * charts reskin across all themes like every other surface. Errors are caught.
 *
 * Security: we render the spec via vega-embed (not vega.parse) and pass only a
 * validated spec object; keep vega updated (scale-expression advisories).
 */

import { useEffect, useRef, useState } from "react";

export interface ChartBlockProps {
  /** A Vega-Lite spec object (data + mark + encoding [+ config]). */
  spec: Record<string, unknown>;
  height?: number;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

/** A curated categorical palette (accent first, then distinct hues) for series. */
function paletteFrom(accent: string): string[] {
  return [accent, "#5ce8be", "#f0a48c", "#97b7de", "#dfc38a", "#ceb5df", "#8ca36e", "#d87c68"];
}

function configFromTokens(el: HTMLElement): Record<string, unknown> {
  const cs = getComputedStyle(el);
  const get = (v: string, f: string) => cs.getPropertyValue(v).trim() || f;
  const text = get("--text-primary", "#1c1d22");
  const muted = get("--text-secondary", "#6b625a");
  const grid = get("--border-subtle", "#e3ddd3");
  const accent = `rgb(${get("--accent-rgb", "212,165,116")})`;
  const font = get("--font-sans", "sans-serif");
  return {
    background: "transparent",
    font,
    axis: { labelColor: muted, titleColor: text, gridColor: grid, domainColor: grid, tickColor: grid, labelFont: font, titleFont: font },
    legend: { labelColor: muted, titleColor: text, labelFont: font, titleFont: font },
    title: { color: text, font },
    view: { stroke: "transparent" },
    range: { category: paletteFrom(accent) },
    mark: { color: accent },
  };
}

export function ChartBlock({ spec, height = 240 }: ChartBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);

  // Re-render when the deck theme flips (data-theme / class on <html>).
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => setThemeVersion((v) => v + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let result: { finalize: () => void } | null = null;
    (async () => {
      try {
        const vegaEmbed = (await import("vega-embed")).default;
        if (cancelled || !ref.current) return;
        const config = configFromTokens(ref.current);
        const full = { width: "container", height, ...spec, config: { ...config, ...((spec.config as object) ?? {}) } };
        result = await vegaEmbed(ref.current, full as never, { actions: false, renderer: "svg" });
        if (cancelled) result.finalize();
        else setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "chart render failed");
      }
    })();
    return () => {
      cancelled = true;
      result?.finalize();
    };
  }, [spec, height, themeVersion]);

  if (error) {
    return (
      <div className="rounded-[var(--radius-sm)] border px-2.5 py-2 text-[var(--text-muted)]" style={{ borderColor: "var(--border-subtle)", ...MONO }}>
        chart error: {error}
      </div>
    );
  }
  return (
    <div
      className="cd-chart overflow-hidden rounded-[var(--radius-sm)] border p-2"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
      data-testid="chart-block"
    >
      <div ref={ref} style={{ width: "100%", minHeight: height }} />
    </div>
  );
}

export default ChartBlock;
