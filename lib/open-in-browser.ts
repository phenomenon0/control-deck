/**
 * openInThemedBrowser — routes an external URL into the deck's themed
 * Electron browser window. Falls back to `window.open` with noopener/
 * noreferrer in web builds or when the preload bridge isn't available.
 *
 * Every surface that shows an external link (leaderboard sources, compare
 * table, inspector) should go through this helper rather than calling
 * `window.deck?.browser.open` inline — single source of truth for how the
 * deck escapes to the web.
 */

export function openInThemedBrowser(url: string): void {
  if (typeof window === "undefined") return;
  const surface = window.deck?.browser;
  if (surface) {
    void surface.open(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
