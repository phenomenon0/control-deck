/**
 * paneFit — guards for terminal fit/resize sizing.
 *
 * wterm's autoResize measures the pane container and emits (cols, rows). When a
 * container is briefly 0×0 (mount race, an animating ancestor, or a `display:none`
 * that slipped through), that measurement collapses toward 1×1. Sending such a
 * size to the PTY/tmux reflows and corrupts the buffer — text gets crammed into
 * one column or lost. `isUsableTerminalSize` is the single gate: only real,
 * finite sizes reach the wire.
 */

/** Smallest cols/rows we'll ever forward to the PTY. Below this is a collapse. */
export const MIN_TERMINAL_COLS = 2;
export const MIN_TERMINAL_ROWS = 2;

export function isUsableTerminalSize(cols: number, rows: number): boolean {
  return (
    Number.isFinite(cols) &&
    Number.isFinite(rows) &&
    cols >= MIN_TERMINAL_COLS &&
    rows >= MIN_TERMINAL_ROWS
  );
}
