/**
 * terminalTheme — the seam between the deck's token system and wterm's palette.
 *
 * wterm is themed entirely through `--term-*` CSS custom properties (see
 * node_modules/@wterm/dom/src/terminal.css). Rather than pass wterm's `theme`
 * prop (which only swaps a preset class), we let app/warp.css's `.cd-term-screen`
 * rules drive `--term-bg/-fg/-cursor/-font` from deck tokens + a per-base ANSI
 * ramp — so the terminal reskins with the cascade, no JS or observer needed.
 *
 * This module just centralizes the class hooks + a metrics reader the clickable
 * link overlay uses to align hotspots to wterm's character grid.
 */

/** Applied to the screen wrapper (faux + live) — warp.css keys all theming off it. */
export const CD_TERM_SCREEN_CLASS = "cd-term-screen";

/** Optional extra class for the wterm element itself (kept for parity/targeting). */
export const CD_TERM_WTERM_CLASS = "cd-term-wterm";

export interface TermMetrics {
  /** Pixel height of one terminal row (--term-row-height). */
  rowHeight: number;
  /** Pixel width of one monospace cell (1ch in the terminal font). */
  charWidth: number;
  /** Left/top padding of the wterm content box. */
  padLeft: number;
  padTop: number;
}

/**
 * Measure the wterm character grid so an overlay can map (row,col) → pixels.
 * Measures 1ch with a throwaway probe span styled like a term cell. Returns null
 * if the element isn't laid out yet.
 */
export function getTermMetrics(wtermEl: HTMLElement | null): TermMetrics | null {
  if (!wtermEl || typeof window === "undefined") return null;
  const cs = getComputedStyle(wtermEl);
  const rowHeight = parseFloat(cs.getPropertyValue("--term-row-height")) || parseFloat(cs.lineHeight) || 17;
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padTop = parseFloat(cs.paddingTop) || 0;

  // Measure one cell width in the terminal's own font.
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(10);
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
  probe.style.font = cs.font;
  probe.style.fontFamily = cs.getPropertyValue("--term-font-family") || cs.fontFamily;
  probe.style.fontSize = cs.getPropertyValue("--term-font-size") || cs.fontSize;
  wtermEl.appendChild(probe);
  const charWidth = probe.getBoundingClientRect().width / 10;
  probe.remove();
  if (!charWidth || !Number.isFinite(charWidth)) return null;

  return { rowHeight, charWidth, padLeft, padTop };
}
