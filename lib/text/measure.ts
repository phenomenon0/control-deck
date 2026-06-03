/**
 * Text measurement core — a thin, font-aware wrapper over `@chenglou/pretext`.
 *
 * Pretext answers layout questions ("how many lines is this string at width W,
 * how tall, how wide is the widest line") using Canvas2D `measureText` +
 * `Intl.Segmenter`, headless and synchronous — no DOM node, no reflow. That's
 * the whole point: we can decide truncation / virtualization heights BEFORE
 * rendering, instead of the classic measure-after-render-then-correct dance.
 *
 * Two things this wrapper adds on top of raw Pretext:
 *   1. **A webfont gate.** `measureText` returns metrics for whatever font is
 *      currently loaded; before the deck's webfonts (Inter / JetBrains Mono /
 *      Source Serif …) finish loading, measurements are wrong. We watch
 *      `document.fonts.ready`, bust Pretext's cache when fonts land, and notify
 *      listeners so hooks can re-measure.
 *   2. **A headless/SSR guard.** Returns null when there's no `document` /
 *      `Intl.Segmenter` (server render), so callers fall back gracefully.
 */

import {
  prepare,
  prepareWithSegments,
  layout,
  measureLineStats,
  measureNaturalWidth,
  clearCache,
} from "@chenglou/pretext";

export interface MeasureOptions {
  whiteSpace?: "normal" | "pre-wrap";
  wordBreak?: "normal" | "keep-all";
  letterSpacing?: number;
}

/** True when the runtime can actually measure (browser/Electron, not SSR). */
export const canMeasureText: boolean =
  typeof document !== "undefined" &&
  typeof (globalThis as { Intl?: { Segmenter?: unknown } }).Intl?.Segmenter === "function";

// ── Webfont readiness ────────────────────────────────────────────────────────
let fontsReady = !canMeasureText; // if we can't measure, "ready" is moot
const readyListeners = new Set<() => void>();

if (canMeasureText && document.fonts?.ready) {
  document.fonts.ready.then(() => {
    fontsReady = true;
    // Metrics computed before the webfonts loaded are stale — drop them.
    clearCache();
    for (const l of readyListeners) l();
  });
} else {
  fontsReady = true;
}

/** Whether the document's webfonts have finished loading (measurements stable). */
export function fontsAreReady(): boolean {
  return fontsReady;
}

/** Subscribe to the one-shot "webfonts loaded" signal. Returns an unsubscribe. */
export function onFontsReady(cb: () => void): () => void {
  if (fontsReady) {
    // Already ready — fire on a microtask so callers can treat it uniformly.
    Promise.resolve().then(cb);
    return () => {};
  }
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

// ── Measurement primitives ───────────────────────────────────────────────────

/** Block layout at a fixed width: total height + line count, or null if headless. */
export function measureBlock(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
  opts?: MeasureOptions,
): { height: number; lineCount: number } | null {
  if (!canMeasureText || maxWidth <= 0) return null;
  return layout(prepare(text, font, opts), maxWidth, lineHeight);
}

/** Line count + widest-line width at a given width, or null if headless. */
export function measureLines(
  text: string,
  font: string,
  maxWidth: number,
  opts?: MeasureOptions,
): { lineCount: number; maxLineWidth: number } | null {
  if (!canMeasureText || maxWidth <= 0) return null;
  return measureLineStats(prepareWithSegments(text, font, opts), maxWidth);
}

/** Width of the text on a single unconstrained line, or null if headless. */
export function measureNatural(text: string, font: string, opts?: MeasureOptions): number | null {
  if (!canMeasureText) return null;
  return measureNaturalWidth(prepareWithSegments(text, font, opts));
}

/**
 * Would this text be truncated when clamped to `maxLines` at `maxWidth`?
 *
 * For a single line this is a cheap natural-width comparison; for multi-line we
 * count the wrapped lines. Returns false when headless (can't know → don't
 * promise a tooltip that won't be needed).
 */
export function isTruncated(
  text: string,
  font: string,
  maxWidth: number,
  maxLines = 1,
  opts?: MeasureOptions,
): boolean {
  if (!canMeasureText || maxWidth <= 0) return false;
  if (maxLines <= 1) {
    const w = measureNatural(text, font, opts);
    return w != null && w > maxWidth + 0.5;
  }
  const stats = measureLines(text, font, maxWidth, opts);
  return stats != null && stats.lineCount > maxLines;
}

/** Re-export so callers that warm/clear the shared cache don't import two modules. */
export { clearCache };
