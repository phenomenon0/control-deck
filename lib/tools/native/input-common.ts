/**
 * Synthetic input shim — cross-platform best-effort mouse/keyboard events.
 *
 * Implementation is lazy: if `@nut-tree/nut-js` is installed at runtime it
 * is used, otherwise this module throws a descriptive error. The Electron
 * main process is the expected caller, and `nut-js` is an optionalDependency
 * so we don't force every web-only deployment to pull in native libs.
 */

export interface MoveOpts {
  x: number;
  y: number;
  /** milliseconds to animate (0 = teleport). */
  durationMs?: number;
}

export interface TypeOpts {
  text: string;
  /** per-character delay in ms (default 10). */
  delayMs?: number;
}

type NutModule = {
  mouse: { setPosition: (p: unknown) => Promise<void>; leftClick: () => Promise<void> };
  keyboard: { config: { autoDelayMs: number }; type: (text: string) => Promise<void> };
  Point: new (x: number, y: number) => unknown;
};

let nut: NutModule | null = null;
let loaded = false;

async function load(): Promise<NutModule | null> {
  if (loaded) return nut;
  loaded = true;
  try {
    // @ts-expect-error — nut-js is an optional runtime dep; resolved via dynamic import at runtime
    const mod = await import("@nut-tree/nut-js");
    nut = mod as unknown as NutModule;
  } catch {
    nut = null;
  }
  return nut;
}

function ensure() {
  if (!nut) {
    throw new Error(
      "synthetic input unavailable: install @nut-tree/nut-js or route through an OS-specific adapter",
    );
  }
  return nut;
}

export async function moveMouse({ x, y, durationMs = 0 }: MoveOpts): Promise<void> {
  const m = await load();
  if (!m) ensure();
  await m!.mouse.setPosition(new m!.Point(x, y));
  if (durationMs > 0) {
    await new Promise((r) => setTimeout(r, durationMs));
  }
}

export async function clickMouse(): Promise<void> {
  const m = await load();
  if (!m) ensure();
  await m!.mouse.leftClick();
}

export async function typeKeys({ text, delayMs = 10 }: TypeOpts): Promise<void> {
  const m = await load();
  if (!m) ensure();
  m!.keyboard.config.autoDelayMs = delayMs;
  await m!.keyboard.type(text);
}

export async function isAvailable(): Promise<boolean> {
  const m = await load();
  return m !== null;
}
