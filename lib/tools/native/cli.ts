#!/usr/bin/env -S bun
/**
 * Standalone CLI for the native automation module.
 *
 * Lets the desktop-automation surface be exercised without booting the rest
 * of Control Deck (Next, Electron, MCP). The same NativeAdapter that the
 * tool executor uses is loaded directly, so what works here is what works
 * end-to-end.
 *
 *   bun lib/tools/native/cli.ts capabilities
 *   bun lib/tools/native/cli.ts locate --app nautilus --role frame --limit 5
 *   bun lib/tools/native/cli.ts tree                          # desktop root
 *   bun lib/tools/native/cli.ts tree --handle '/0/3/0'        # subtree
 *   bun lib/tools/native/cli.ts focus-window org.telegram.desktop
 *   bun lib/tools/native/cli.ts key Ctrl+l
 *   bun lib/tools/native/cli.ts type --text 'hello world'     # focused widget
 *   bun lib/tools/native/cli.ts screen-grab --out /tmp/grab.png
 *   bun lib/tools/native/cli.ts click-pixel 640 400 --button left
 *
 * All output is JSON on stdout (one line per command); diagnostics on stderr.
 * Exit codes: 0 ok, 1 user error (bad args), 2 adapter/runtime error.
 */
import { getNativeAdapter } from "./index";
import { executeNativeCapabilities } from "../handlers/native";
import type { LocateQuery, NodeHandle, PointerButton } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function asString(v: string | true | undefined, label: string): string {
  if (typeof v !== "string") throw new UserError(`--${label} requires a value`);
  return v;
}

function asInt(v: string | true | undefined, label: string): number {
  const s = asString(v, label);
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new UserError(`--${label} must be an integer (got ${s})`);
  }
  return n;
}

function asPositional(positional: string[], idx: number, label: string): string {
  if (idx >= positional.length) throw new UserError(`missing positional arg: ${label}`);
  return positional[idx];
}

class UserError extends Error {}

function emit(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

const HELP = `native-cli — exercise Control Deck native automation without the full stack.

Usage: bun lib/tools/native/cli.ts <command> [args] [--flag value ...]

Commands:
  capabilities                            Probe platform, session, helper, portal, per-tool status.
  locate [--name] [--role] [--app] [--limit]
                                          Query the accessibility tree. Returns NodeHandle[].
  click <handle-id>                       Click a previously-located handle (cascade: action→focus+enter→mouse).
  type --text <text> [--handle <id>]      Type into handle, or focused widget if omitted.
  tree [--handle <id>]                    Dump subtree (or desktop root if --handle omitted).
  key <key|combo>                         e.g. "Return", "Ctrl+l", "Alt+F10".
  focus <handle-id>                       Move focus to handle. Prints { focused: bool }.
  screen-grab [--out <path>]              Full desktop PNG. Writes to --out if given, else base64+meta JSON.
  focus-window <app-id>                   xdg_activation raise (e.g. org.telegram.desktop).
  click-pixel <x> <y> [--button left|right|middle]
                                          Absolute pixel click via portal (Wayland-safe).

Exit codes: 0 ok, 1 user error, 2 adapter/runtime error.
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    process.stderr.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }

  const cmd = argv[0];
  const { positional, flags } = parseFlags(argv.slice(1));
  const adapter = await getNativeAdapter();

  switch (cmd) {
    case "capabilities": {
      // Delegate to the shared handler so the CLI prints exactly what agents
      // see — including the live portal round-trip (file-presence isn't enough).
      const result = await executeNativeCapabilities({});
      emit(result.data);
      return 0;
    }

    case "locate": {
      const query: LocateQuery = {};
      if (typeof flags.name === "string") query.name = flags.name;
      if (typeof flags.role === "string") query.role = flags.role;
      if (typeof flags.app === "string") query.app = flags.app;
      if (flags.limit !== undefined) query.limit = asInt(flags.limit, "limit");
      const handles = await adapter.locate(query);
      emit(handles);
      return 0;
    }

    case "click": {
      const id = asPositional(positional, 0, "<handle-id>");
      const handle = handleFromFlagsOrId(id, flags);
      const result = await adapter.click(handle);
      emit(result);
      return 0;
    }

    case "type": {
      const text = asString(flags.text, "text");
      const handle = typeof flags.handle === "string" ? handleFromFlagsOrId(flags.handle, flags) : null;
      await adapter.typeText(handle, text);
      emit({ ok: true });
      return 0;
    }

    case "tree": {
      const handle = typeof flags.handle === "string" ? handleFromFlagsOrId(flags.handle, flags) : undefined;
      const tree = await adapter.getTree(handle);
      emit(tree);
      return 0;
    }

    case "key": {
      const key = asPositional(positional, 0, "<key|combo>");
      await adapter.key({ key });
      emit({ ok: true });
      return 0;
    }

    case "focus": {
      const id = asPositional(positional, 0, "<handle-id>");
      const handle = handleFromFlagsOrId(id, flags);
      const focused = await adapter.focus(handle);
      emit({ focused });
      return 0;
    }

    case "screen-grab": {
      const result = await adapter.screenGrab();
      if (typeof flags.out === "string") {
        const outPath = path.resolve(flags.out);
        fs.writeFileSync(outPath, Buffer.from(result.pngBase64, "base64"));
        emit({ path: outPath, width: result.width, height: result.height });
      } else {
        emit(result);
      }
      return 0;
    }

    case "focus-window": {
      const appId = asPositional(positional, 0, "<app-id>");
      const result = await adapter.focusWindow(appId);
      emit(result);
      return 0;
    }

    case "click-pixel": {
      const x = Number(asPositional(positional, 0, "<x>"));
      const y = Number(asPositional(positional, 1, "<y>"));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new UserError("x and y must be numbers");
      let button: PointerButton = "left";
      if (typeof flags.button === "string") {
        if (flags.button !== "left" && flags.button !== "right" && flags.button !== "middle") {
          throw new UserError(`--button must be left|right|middle (got ${flags.button})`);
        }
        button = flags.button;
      }
      await adapter.clickPixel({ x, y, button });
      emit({ ok: true });
      return 0;
    }

    default:
      throw new UserError(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

// Reconstruct a NodeHandle from a CLI-supplied id. Adapters round-trip the
// id field opaquely; role/name/path are diagnostics only and not required
// for click/type/focus.
function handleFromFlagsOrId(id: string, flags: Flags): NodeHandle {
  const handle: NodeHandle = { id };
  if (typeof flags["handle-role"] === "string") handle.role = flags["handle-role"];
  if (typeof flags["handle-name"] === "string") handle.name = flags["handle-name"];
  if (typeof flags["handle-path"] === "string") handle.path = flags["handle-path"];
  return handle;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof UserError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
    process.stderr.write(`adapter error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
