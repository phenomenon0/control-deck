/**
 * Native workspace tools — ports of Agent-GO's read_file/write_file/edit_file
 * /glob/grep/bash. All file paths flow through {@link WorkspaceJail}; bash runs
 * with `cwd: workspace.root` and a hard wallclock cap.
 *
 * Tool definitions use typebox schemas as required by pi-agent-core.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { Type, type Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import { WorkspaceJail } from "./jail.js";

const MAX_BASH_MS = parseInt(process.env.AGENT_TS_BASH_TIMEOUT_MS ?? "60000", 10);
const MAX_OUTPUT_BYTES = parseInt(process.env.AGENT_TS_BASH_OUTPUT_BYTES ?? "262144", 10);

type AnyTool = AgentTool<any, any>;

function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

export function nativeTools(jail: WorkspaceJail): AnyTool[] {
  return [
    readFile(jail) as AnyTool,
    writeFile(jail) as AnyTool,
    editFile(jail) as AnyTool,
    glob(jail) as AnyTool,
    grep(jail) as AnyTool,
    bash(jail) as AnyTool,
  ];
}

function readFile(jail: WorkspaceJail) {
  const params = Type.Object({
    path: Type.String({ description: "Workspace-relative file path." }),
  });
  return {
    name: "read_file",
    label: "Read file",
    description: "Read a UTF-8 text file from the workspace.",
    parameters: params,
    async execute(_id: string, args: Static<typeof params>) {
      const abs = jail.resolve(args.path);
      const buf = await fs.readFile(abs);
      const text = buf.toString("utf8");
      return {
        content: [{ type: "text", text }],
        details: { path: jail.toRelative(abs), bytes: buf.byteLength },
      };
    },
  };
}

function writeFile(jail: WorkspaceJail) {
  const params = Type.Object({
    path: Type.String({ description: "Workspace-relative file path." }),
    content: Type.String({ description: "Full new contents (UTF-8)." }),
  });
  return {
    name: "write_file",
    label: "Write file",
    description: "Write or overwrite a text file in the workspace.",
    parameters: params,
    async execute(_id: string, args: Static<typeof params>) {
      const abs = jail.resolve(args.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, args.content, "utf8");
      const bytes = Buffer.byteLength(args.content, "utf8");
      return textResult(`Wrote ${jail.toRelative(abs)} (${bytes} bytes)`, {
        path: jail.toRelative(abs),
        bytes,
      });
    },
  };
}

function editFile(jail: WorkspaceJail) {
  const params = Type.Object({
    path: Type.String({ description: "Workspace-relative file path." }),
    old_string: Type.String({ description: "Exact text to replace." }),
    new_string: Type.String({ description: "Replacement text." }),
    replace_all: Type.Optional(Type.Boolean({ default: false })),
  });
  return {
    name: "edit_file",
    label: "Edit file",
    description: "Replace text in a workspace file. Default: first occurrence only.",
    parameters: params,
    async execute(_id: string, args: Static<typeof params>) {
      const abs = jail.resolve(args.path);
      const original = await fs.readFile(abs, "utf8");
      let next: string;
      let count: number;
      if (args.replace_all) {
        const parts = original.split(args.old_string);
        count = parts.length - 1;
        next = parts.join(args.new_string);
      } else {
        const idx = original.indexOf(args.old_string);
        if (idx < 0) {
          throw new Error(`old_string not found in ${jail.toRelative(abs)}`);
        }
        count = 1;
        next =
          original.slice(0, idx) + args.new_string + original.slice(idx + args.old_string.length);
      }
      if (count === 0) {
        throw new Error(`old_string not found in ${jail.toRelative(abs)}`);
      }
      await fs.writeFile(abs, next, "utf8");
      return textResult(`Edited ${jail.toRelative(abs)} (${count} replacement${count === 1 ? "" : "s"})`, {
        path: jail.toRelative(abs),
        replacements: count,
      });
    },
  };
}

function glob(jail: WorkspaceJail) {
  const params = Type.Object({
    pattern: Type.String({
      description: "Glob pattern relative to workspace (uses shell `find` semantics).",
    }),
    limit: Type.Optional(Type.Number({ default: 200, minimum: 1, maximum: 5000 })),
  });
  return {
    name: "glob",
    label: "Glob",
    description: "List files in the workspace matching a glob/find pattern.",
    parameters: params,
    async execute(_id: string, args: Static<typeof params>, signal?: AbortSignal) {
      const limit = args.limit ?? 200;
      const matches = await runProcess(
        "find",
        [".", "-path", `./${args.pattern}`, "-not", "-path", "./node_modules/*", "-type", "f"],
        { cwd: jail.root, signal },
      );
      const list = matches.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, limit);
      return textResult(list.length ? list.join("\n") : "(no matches)", { matches: list });
    },
  };
}

function grep(jail: WorkspaceJail) {
  const params = Type.Object({
    pattern: Type.String({ description: "Regex pattern to search for." }),
    path: Type.Optional(
      Type.String({ description: "Workspace-relative directory or file. Default: workspace root." }),
    ),
    limit: Type.Optional(Type.Number({ default: 200, minimum: 1, maximum: 2000 })),
  });
  return {
    name: "grep",
    label: "Search",
    description: "Search the workspace with grep -rn.",
    parameters: params,
    async execute(_id: string, args: Static<typeof params>, signal?: AbortSignal) {
      const target = args.path ? jail.resolve(args.path) : jail.root;
      const limit = args.limit ?? 200;
      const proc = await runProcess(
        "grep",
        ["-rn", "--exclude-dir=node_modules", "--exclude-dir=.git", "-E", args.pattern, target],
        { cwd: jail.root, signal, allowNonZeroExit: true },
      );
      const lines = proc.stdout.split("\n").filter(Boolean).slice(0, limit);
      const matches = lines
        .map((line) => {
          const m = line.match(/^([^:]+):(\d+):(.*)$/);
          if (!m) return null;
          return {
            path: jail.toRelative(path.resolve(m[1])),
            line: parseInt(m[2], 10),
            text: m[3],
          };
        })
        .filter((x): x is { path: string; line: number; text: string } => x !== null);
      return textResult(lines.length ? lines.join("\n") : "(no matches)", { matches });
    },
  };
}

function bash(jail: WorkspaceJail) {
  const params = Type.Object({
    command: Type.String({ description: "Shell command (sh -c). Runs inside the workspace." }),
    timeout_ms: Type.Optional(Type.Number({ description: "Override default timeout." })),
  });
  return {
    name: "bash",
    label: "Bash",
    description: `Run a shell command in the workspace. Wallclock-capped.`,
    parameters: params,
    async execute(_id: string, args: Static<typeof params>, signal?: AbortSignal) {
      const timeout = Math.min(args.timeout_ms ?? MAX_BASH_MS, 5 * 60_000);
      const proc = await runProcess("sh", ["-c", args.command], {
        cwd: jail.root,
        signal,
        timeoutMs: timeout,
        allowNonZeroExit: true,
      });
      const summary =
        `exit ${proc.exitCode}\n` +
        (proc.stdout ? `stdout:\n${proc.stdout}\n` : "") +
        (proc.stderr ? `stderr:\n${proc.stderr}\n` : "");
      return {
        content: [{ type: "text", text: summary }],
        details: { exitCode: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr },
      };
    },
  };
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  allowNonZeroExit?: boolean;
}

function runProcess(cmd: string, argv: string[], opts: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const cap = (chunk: Buffer, sink: { value: string }) => {
      const remaining = MAX_OUTPUT_BYTES - sink.value.length;
      if (remaining <= 0) return;
      sink.value += chunk.toString("utf8", 0, Math.min(chunk.byteLength, remaining));
    };

    child.stdout.on("data", (c: Buffer) => {
      const sink = { value: stdout };
      cap(c, sink);
      stdout = sink.value;
    });
    child.stderr.on("data", (c: Buffer) => {
      const sink = { value: stderr };
      cap(c, sink);
      stderr = sink.value;
    });

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    const onAbort = () => {
      killed = true;
      child.kill("SIGKILL");
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      const exitCode = code ?? -1;
      if (killed) {
        reject(new Error(`Process killed (timeout or abort)`));
        return;
      }
      if (exitCode !== 0 && !opts.allowNonZeroExit) {
        reject(new Error(`Command failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}
