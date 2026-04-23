/**
 * Shared keysym parser for native-surface adapters.
 *
 * All platforms accept the same key spec format so agents can send
 * "Ctrl+Shift+Tab" without caring whether the host is Linux, macOS, or
 * Windows. Primary keys are expressed as X11 keysym names (historic
 * lingua franca of accessibility APIs); adapters map to their own
 * native key code space (VK_* on Windows, kVK_* on macOS, keysyms on
 * Linux) after parsing.
 */

/** X11 keysym codes for non-character primary keys. */
export const KEYSYMS: Record<string, number> = {
  return: 0xff0d, enter: 0xff0d, tab: 0xff09, escape: 0xff1b,
  backspace: 0xff08, delete: 0xffff, space: 0x0020,
  up: 0xff52, down: 0xff54, left: 0xff51, right: 0xff53,
  home: 0xff50, end: 0xff57, pageup: 0xff55, pagedown: 0xff56,
  f1: 0xffbe, f2: 0xffbf, f3: 0xffc0, f4: 0xffc1, f5: 0xffc2, f6: 0xffc3,
  f7: 0xffc4, f8: 0xffc5, f9: 0xffc6, f10: 0xffc7, f11: 0xffc8, f12: 0xffc9,
  menu: 0xff67,
};

/** X11 keysym codes for modifier keys. */
export const MODIFIERS: Record<string, number> = {
  shift: 0xffe1, ctrl: 0xffe3, control: 0xffe3, alt: 0xffe9, super: 0xffeb, meta: 0xffe7,
};

export interface ParsedKey {
  modifiers: number[];
  primary: number;
}

/**
 * Parse a key spec string like "Ctrl+Shift+Tab" or "a" or "Return"
 * into modifier keysyms + a primary keysym.
 *
 * Accepts:
 *  - single characters ("a", "1", " ") — primary becomes the Unicode codepoint
 *  - X11 keysym names ("Return", "Tab", "Escape", "F10", "Left")
 *  - "+"-separated combos ("Ctrl+l", "Alt+F10", "Ctrl+Shift+Tab")
 */
export function parseKeySpec(spec: string): ParsedKey {
  // Special case: a bare "+" or " " is a literal primary key, not a
  // combo separator. Combos never start or end with "+" and always
  // have at least one text part before the separator.
  if (spec === "+" || spec === " ") {
    return { modifiers: [], primary: spec.codePointAt(0)! };
  }
  const parts = spec.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error(`empty key spec: ${spec}`);
  const primaryRaw = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1)
    .map((p) => MODIFIERS[p.toLowerCase()])
    .filter((k): k is number => typeof k === "number");
  const lower = primaryRaw.toLowerCase();
  let primary: number;
  if (KEYSYMS[lower] !== undefined) primary = KEYSYMS[lower];
  else if (primaryRaw.length === 1) primary = primaryRaw.codePointAt(0)!;
  else throw new Error(`unknown key ${primaryRaw}`);
  return { modifiers, primary };
}
