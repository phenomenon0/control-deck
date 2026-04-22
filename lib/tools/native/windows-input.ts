/**
 * Windows input + window-management FFI via koffi.
 *
 * Surface:
 *  - sendKey(spec)      — SendInput keyboard via UNICODE scancodes
 *  - sendMouseClick(...) — SendInput absolute-coord click over virtual desktop
 *  - focusWindow(appId) — AUMID resolve → AttachThreadInput + SetForegroundWindow
 *  - screenCapture()    — PNG via node-screenshots
 *
 * All Win32 calls go through koffi, no native addons. node-screenshots
 * is the only compiled dep and ships prebuilt N-API binaries.
 */

import koffi from "koffi";
import { parseKeySpec, type ParsedKey } from "./keysym";
import type { FocusWindowResult, KeyEvent, PointerButton } from "./types";

// ---------------------------------------------------------------------
//  Win32 constants
// ---------------------------------------------------------------------

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;

const KEYEVENTF_UNICODE = 0x0004;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const KEYEVENTF_EXTENDEDKEY = 0x0001;

const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;
const MOUSEEVENTF_ABSOLUTE = 0x8000;
const MOUSEEVENTF_VIRTUALDESK = 0x4000;

const SW_RESTORE = 9;

const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;

// X11 keysym → Win32 VK_* code. Covers the keysyms our keysym.ts emits.
const KEYSYM_TO_VK: Record<number, number> = {
  0xff0d: 0x0d, // Return/Enter → VK_RETURN
  0xff09: 0x09, // Tab → VK_TAB
  0xff1b: 0x1b, // Escape → VK_ESCAPE
  0xff08: 0x08, // Backspace → VK_BACK
  0xffff: 0x2e, // Delete → VK_DELETE
  0x0020: 0x20, // Space → VK_SPACE
  0xff52: 0x26, // Up → VK_UP
  0xff54: 0x28, // Down → VK_DOWN
  0xff51: 0x25, // Left → VK_LEFT
  0xff53: 0x27, // Right → VK_RIGHT
  0xff50: 0x24, // Home → VK_HOME
  0xff57: 0x23, // End → VK_END
  0xff55: 0x21, // PageUp → VK_PRIOR
  0xff56: 0x22, // PageDown → VK_NEXT
  0xffbe: 0x70, // F1..F12
  0xffbf: 0x71,
  0xffc0: 0x72,
  0xffc1: 0x73,
  0xffc2: 0x74,
  0xffc3: 0x75,
  0xffc4: 0x76,
  0xffc5: 0x77,
  0xffc6: 0x78,
  0xffc7: 0x79,
  0xffc8: 0x7a,
  0xffc9: 0x7b,
  0xff67: 0x5d, // Menu → VK_APPS
  0xffe1: 0x10, // Shift → VK_SHIFT
  0xffe3: 0x11, // Ctrl/Control → VK_CONTROL
  0xffe9: 0x12, // Alt → VK_MENU
  0xffeb: 0x5b, // Super → VK_LWIN
  0xffe7: 0x5b, // Meta → VK_LWIN (best-effort)
};

// ---------------------------------------------------------------------
//  koffi bindings
// ---------------------------------------------------------------------

// INPUT is a tagged union. 40 bytes on x64 (4-byte type + 4-byte pad +
// 32-byte union payload). We declare one struct big enough for the
// largest variant (MOUSEINPUT is 32 bytes after alignment) and overlay
// both variants manually when filling.

const ULONG_PTR = "uintptr";

const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
  dx: "int32",
  dy: "int32",
  mouseData: "uint32",
  dwFlags: "uint32",
  time: "uint32",
  dwExtraInfo: ULONG_PTR,
});

const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
  wVk: "uint16",
  wScan: "uint16",
  dwFlags: "uint32",
  time: "uint32",
  dwExtraInfo: ULONG_PTR,
});

// Tagged union payload — we emit one or the other; size must match
// MOUSEINPUT so the stride is correct for SendInput's array form.
const INPUT_UNION = koffi.union("INPUT_UNION", {
  mi: MOUSEINPUT,
  ki: KEYBDINPUT,
});

const INPUT = koffi.struct("INPUT", {
  type: "uint32",
  _pad: "uint32",
  u: INPUT_UNION,
});

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");

const SendInput = user32.func("__stdcall", "SendInput", "uint32", [
  "uint32",
  koffi.pointer(INPUT),
  "int32",
]);

const GetSystemMetrics = user32.func("__stdcall", "GetSystemMetrics", "int32", ["int32"]);

const GetForegroundWindow = user32.func("__stdcall", "GetForegroundWindow", "void*", []);
const SetForegroundWindow = user32.func("__stdcall", "SetForegroundWindow", "int32", ["void*"]);
const ShowWindow = user32.func("__stdcall", "ShowWindow", "int32", ["void*", "int32"]);
const IsIconic = user32.func("__stdcall", "IsIconic", "int32", ["void*"]);
const GetWindowThreadProcessId = user32.func(
  "__stdcall",
  "GetWindowThreadProcessId",
  "uint32",
  ["void*", koffi.out(koffi.pointer("uint32"))],
);
const AttachThreadInput = user32.func("__stdcall", "AttachThreadInput", "int32", [
  "uint32",
  "uint32",
  "int32",
]);
const GetCurrentThreadId = kernel32.func("__stdcall", "GetCurrentThreadId", "uint32", []);

const EnumWindowsProc = koffi.proto(
  "__stdcall",
  "EnumWindowsProc",
  "int32",
  ["void*", "intptr"],
);
const EnumWindows = user32.func("__stdcall", "EnumWindows", "int32", [
  koffi.pointer(EnumWindowsProc),
  "intptr",
]);
const IsWindowVisible = user32.func("__stdcall", "IsWindowVisible", "int32", ["void*"]);

// ---------------------------------------------------------------------
//  key injection
// ---------------------------------------------------------------------

export async function sendKey(event: KeyEvent): Promise<void> {
  const parsed = parseKeySpec(event.key);
  const presses = buildKeySequence(parsed);
  const inputs = presses.map((evt) => makeKeyInput(evt));
  send(inputs);
}

interface KeyPress {
  vk: number;
  unicode?: number;
  up: boolean;
}

function buildKeySequence(parsed: ParsedKey): KeyPress[] {
  const seq: KeyPress[] = [];

  // Press modifiers
  for (const m of parsed.modifiers) {
    const vk = KEYSYM_TO_VK[m];
    if (vk) seq.push({ vk, up: false });
  }

  // Primary key
  const primaryVk = KEYSYM_TO_VK[parsed.primary];
  if (primaryVk !== undefined) {
    seq.push({ vk: primaryVk, up: false });
    seq.push({ vk: primaryVk, up: true });
  } else {
    // Unicode codepoint — SendInput UNICODE for any BMP char
    seq.push({ vk: 0, unicode: parsed.primary, up: false });
    seq.push({ vk: 0, unicode: parsed.primary, up: true });
  }

  // Release modifiers in reverse
  for (let i = parsed.modifiers.length - 1; i >= 0; i--) {
    const vk = KEYSYM_TO_VK[parsed.modifiers[i]];
    if (vk) seq.push({ vk, up: true });
  }

  return seq;
}

function makeKeyInput(press: KeyPress): Record<string, unknown> {
  let flags = 0;
  if (press.up) flags |= KEYEVENTF_KEYUP;
  if (press.unicode !== undefined) flags |= KEYEVENTF_UNICODE;

  return {
    type: INPUT_KEYBOARD,
    _pad: 0,
    u: {
      ki: {
        wVk: press.unicode !== undefined ? 0 : press.vk,
        wScan: press.unicode ?? 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
}

// ---------------------------------------------------------------------
//  Unicode typing — delegates to sendKey() per-codepoint but batches
// ---------------------------------------------------------------------

export async function typeText(text: string): Promise<void> {
  const inputs: Record<string, unknown>[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Surrogate pairs need two KEYEVENTF_UNICODE presses.
    if (cp > 0xffff) {
      const high = 0xd800 + ((cp - 0x10000) >> 10);
      const low = 0xdc00 + ((cp - 0x10000) & 0x3ff);
      for (const unit of [high, low]) {
        inputs.push(makeKeyInput({ vk: 0, unicode: unit, up: false }));
        inputs.push(makeKeyInput({ vk: 0, unicode: unit, up: true }));
      }
    } else {
      inputs.push(makeKeyInput({ vk: 0, unicode: cp, up: false }));
      inputs.push(makeKeyInput({ vk: 0, unicode: cp, up: true }));
    }
  }
  send(inputs);
}

// ---------------------------------------------------------------------
//  mouse click at absolute coords
// ---------------------------------------------------------------------

export async function clickPixel(x: number, y: number, button: PointerButton): Promise<void> {
  // Virtual desktop origin + size — SendInput with VIRTUALDESK normalizes
  // coords to 0..65535 across all monitors.
  const vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (vw <= 0 || vh <= 0) throw new Error("virtual desktop size unavailable");

  const normX = Math.round(((x - vx) * 65535) / (vw - 1));
  const normY = Math.round(((y - vy) * 65535) / (vh - 1));

  const [downFlag, upFlag] = buttonFlags(button);

  const moveInput = makeMouseInput({
    dx: normX,
    dy: normY,
    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
  });
  const downInput = makeMouseInput({
    dx: normX,
    dy: normY,
    dwFlags: downFlag | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
  });
  const upInput = makeMouseInput({
    dx: normX,
    dy: normY,
    dwFlags: upFlag | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
  });

  send([moveInput, downInput, upInput]);
}

function buttonFlags(button: PointerButton): [number, number] {
  switch (button) {
    case "right": return [MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP];
    case "middle": return [MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP];
    default: return [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP];
  }
}

function makeMouseInput(opts: {
  dx: number;
  dy: number;
  mouseData?: number;
  dwFlags: number;
}): Record<string, unknown> {
  return {
    type: INPUT_MOUSE,
    _pad: 0,
    u: {
      mi: {
        dx: opts.dx,
        dy: opts.dy,
        mouseData: opts.mouseData ?? 0,
        dwFlags: opts.dwFlags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
}

// ---------------------------------------------------------------------
//  SendInput — dispatch the batch
// ---------------------------------------------------------------------

function send(inputs: Record<string, unknown>[]): void {
  if (!inputs.length) return;
  const written = SendInput(inputs.length, inputs as unknown as Buffer, koffi.sizeof(INPUT));
  if (written !== inputs.length) {
    throw new Error(`SendInput wrote ${written}/${inputs.length} events`);
  }
}

// ---------------------------------------------------------------------
//  focus window (raise + foreground)
// ---------------------------------------------------------------------

export async function focusWindow(appId: string): Promise<FocusWindowResult> {
  const log: string[] = [];
  const hwnd = findWindowByApp(appId, log);
  if (!hwnd) {
    return { dispatched: false, log: log.join("\n") };
  }

  // Restore if minimized.
  if (IsIconic(hwnd)) {
    ShowWindow(hwnd, SW_RESTORE);
    log.push("ShowWindow(SW_RESTORE)");
  }

  // AttachThreadInput trick to bypass foreground lock.
  const foreground = GetForegroundWindow();
  const currentTid = GetCurrentThreadId();
  const targetTid = GetWindowThreadProcessId(hwnd, [0])[0];
  let fgTid = currentTid;
  if (foreground) {
    fgTid = GetWindowThreadProcessId(foreground, [0])[0];
  }

  let attached = false;
  if (fgTid && fgTid !== currentTid) {
    attached = AttachThreadInput(currentTid, fgTid, 1) !== 0;
    log.push(`AttachThreadInput(curr→fg)=${attached}`);
  }

  const setOk = SetForegroundWindow(hwnd) !== 0;
  log.push(`SetForegroundWindow=${setOk}`);

  if (attached && fgTid !== currentTid) {
    AttachThreadInput(currentTid, fgTid, 0);
  }

  return { dispatched: setOk, log: log.join("\n") };
}

function findWindowByApp(appId: string, log: string[]): Buffer | null {
  // Match strategy: process name equality (case-insensitive). AUMID
  // resolution via SHGetPropertyStoreForWindow is deferred — process
  // name handles explorer.exe, notepad.exe, Telegram.exe, etc., which
  // covers the common case.
  let matched: Buffer | null = null;
  const wantName = appId.replace(/\.exe$/i, "").toLowerCase();

  const callback = koffi.register(
    (hwnd: Buffer /*HWND*/ /*, lparam: number*/) => {
      if (matched) return 0;
      if (!IsWindowVisible(hwnd)) return 1;
      const pidBuf = [0];
      GetWindowThreadProcessId(hwnd, pidBuf);
      const pid = pidBuf[0];
      try {
        // Use Node's built-in `process` list via a sync shell call
        // would be expensive per-window. Instead: read
        // QueryFullProcessImageNameW via psapi — or just spawn wmic
        // once. For this first version we take a simpler route and
        // compare by HWND text (GetWindowTextW) against the appId.
        const titleMatches = windowTitleIncludes(hwnd, wantName);
        if (titleMatches) {
          matched = hwnd;
          return 0;
        }
      } catch {
        /* ignore */
      }
      return 1;
    },
    koffi.pointer(EnumWindowsProc),
  );

  EnumWindows(callback, 0);
  koffi.unregister(callback);

  if (matched) {
    log.push(`matched hwnd by title substring "${wantName}"`);
  } else {
    log.push(`no visible window matched app_id="${appId}"`);
  }
  return matched;
}

// Tiny GetWindowTextW wrapper to substring-match titles.
const GetWindowTextW = user32.func("__stdcall", "GetWindowTextW", "int32", [
  "void*",
  koffi.out(koffi.pointer("uint16")),
  "int32",
]);

function windowTitleIncludes(hwnd: Buffer, needle: string): boolean {
  const bufLen = 512;
  const buf = Buffer.alloc(bufLen * 2);
  const len = GetWindowTextW(hwnd, buf, bufLen);
  if (len <= 0) return false;
  const title = buf.slice(0, len * 2).toString("utf16le").toLowerCase();
  return title.includes(needle);
}

// ---------------------------------------------------------------------
//  screen capture — delegated to node-screenshots
// ---------------------------------------------------------------------

export interface ScreenShot {
  pngBase64: string;
  width: number;
  height: number;
}

export async function screenCapture(): Promise<ScreenShot> {
  const mod = await import("node-screenshots").catch((err) => {
    throw new Error(
      `screen capture requires "node-screenshots" — install it, then run again. (${err})`,
    );
  });
  const MonitorCls = (mod as { Monitor: unknown }).Monitor as {
    all: () => Array<{
      isPrimary?: () => boolean;
      captureImage: () => Promise<{
        toPng: () => Promise<Buffer>;
        width: number;
        height: number;
      }>;
    }>;
  };

  const monitors = MonitorCls.all();
  if (!monitors.length) throw new Error("no monitors detected");

  // Prefer the primary display; fall back to monitor[0] if none flagged.
  const primary = monitors.find((m) => m.isPrimary?.() === true) ?? monitors[0];
  const image = await primary.captureImage();
  const pngBuffer = await image.toPng();
  return {
    pngBase64: pngBuffer.toString("base64"),
    width: image.width,
    height: image.height,
  };
}
