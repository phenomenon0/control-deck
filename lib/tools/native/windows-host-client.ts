/**
 * JSON-RPC client for WinAutomationHost.exe — the C# UIA sidecar.
 *
 * Framing: LSP-style "Content-Length: N\r\n\r\n<body>".
 * Transport: stdio on a long-lived spawned process.
 * Supervision: up to RESTART_MAX automatic restarts on crash.
 *
 * Callers (`windows-uia.ts`) use `call(method, params)` and wait for
 * the resolved result. Errors from the host bubble as Error with
 * code + message.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_TIMEOUT_MS = 5_000;
const WAIT_TIMEOUT_MS = 65_000; // wait_for may request up to 60s
const RESTART_MAX = 3;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export interface HostCallOptions {
  timeoutMs?: number;
}

export class WindowsHostError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

class WindowsHostClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private restartCount = 0;
  private starting: Promise<void> | null = null;
  private hostPath: string;

  constructor() {
    this.hostPath = resolveHostPath();
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> | null | undefined,
    opts: HostCallOptions = {},
  ): Promise<T> {
    await this.ensureRunning();
    if (!this.proc) throw new Error("windows-host: not running");

    const id = this.nextId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");

    const timeoutMs =
      opts.timeoutMs ??
      (method === "wait_for" ? WAIT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`windows-host: ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
      });
      this.proc!.stdin.write(header);
      this.proc!.stdin.write(body);
    });
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.call("shutdown", {}, { timeoutMs: 1_000 });
    } catch {
      // ignore
    }
    this.killProc();
  }

  private async ensureRunning(): Promise<void> {
    if (this.proc && !this.proc.killed) return;
    if (this.starting) return this.starting;

    this.starting = new Promise<void>((resolve, reject) => {
      if (!fs.existsSync(this.hostPath)) {
        reject(new Error(
          `windows-host: WinAutomationHost.exe not found at ${this.hostPath} — run \`bun run electron:win-host\``,
        ));
        return;
      }

      const proc = spawn(this.hostPath, [], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      proc.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
      proc.stderr.on("data", (chunk: Buffer) => {
        // Forward host diagnostics to our stderr so Electron logs them.
        process.stderr.write(`[win-host] ${chunk}`);
      });
      proc.on("exit", (code) => this.onExit(code));
      proc.on("error", (err) => reject(err));

      this.proc = proc;
      resolve();
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  private onStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const sep = this.buffer.indexOf("\r\n\r\n");
      if (sep < 0) return;

      const headerText = this.buffer.slice(0, sep).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!match) {
        // Corrupt frame — skip past this header and keep going.
        this.buffer = this.buffer.slice(sep + 4);
        continue;
      }
      const bodyLen = parseInt(match[1], 10);
      const bodyStart = sep + 4;
      const bodyEnd = bodyStart + bodyLen;
      if (this.buffer.length < bodyEnd) return;

      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const msg = JSON.parse(body);
        this.dispatchResponse(msg);
      } catch (err) {
        process.stderr.write(`[win-host] bad response: ${err}\n${body}\n`);
      }
    }
  }

  private dispatchResponse(msg: {
    id?: number;
    result?: unknown;
    error?: { code: number; message: string };
  }): void {
    if (typeof msg.id !== "number") return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(new WindowsHostError(msg.error.code, msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private onExit(code: number | null): void {
    const err = new Error(`windows-host: process exited with code ${code}`);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    this.proc = null;

    if (code !== 0 && this.restartCount < RESTART_MAX) {
      this.restartCount++;
      process.stderr.write(
        `[win-host] restarting (attempt ${this.restartCount}/${RESTART_MAX})\n`,
      );
      // Lazy restart on next call — don't spin up speculatively.
    }
  }

  private killProc(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    this.proc = null;
    this.buffer = Buffer.alloc(0);
  }
}

function resolveHostPath(): string {
  if (process.env.CONTROL_DECK_WIN_HOST) {
    return process.env.CONTROL_DECK_WIN_HOST;
  }

  // Packaged Electron: resources/win/WinAutomationHost.exe
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const packaged = path.join(resourcesPath, "win", "WinAutomationHost.exe");
    if (fs.existsSync(packaged)) return packaged;
  }

  // Dev: staged by `bun run electron:win-host` into electron/resources/win
  const candidates = [
    path.join(process.cwd(), "electron", "resources", "win", "WinAutomationHost.exe"),
    path.join(__dirname, "..", "..", "..", "electron", "resources", "win", "WinAutomationHost.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

let singleton: WindowsHostClient | null = null;

export function getWindowsHostClient(): WindowsHostClient {
  if (!singleton) singleton = new WindowsHostClient();
  return singleton;
}
