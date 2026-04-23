/**
 * Node-side client for the long-lived `scripts/remote-desktop.py` daemon.
 *
 * Supersedes the old dbus-next RemoteDesktop path (retired 2026-04).
 * The Python daemon avoids the dbus-next hang on Electron 41 / Node 24.
 * The Python daemon is spawned once per Electron launch and reached over a
 * Unix-domain socket with line-delimited JSON requests/responses.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export interface RemoteDesktopStatus {
  keyboardReady: boolean;
  pointerReady: boolean;
  alive: boolean;
}

export interface RemoteDesktopKeyArgs {
  modifiers?: number[];
  keysym: number;
}

export interface RemoteDesktopClickArgs {
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
}

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
};

const READY_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 15_000;

export class RemoteDesktopClient {
  private proc: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private socketPath: string;
  private tokenDir: string;
  private helper: string;
  private queue: PendingRequest[] = [];
  private readBuffer = "";
  private initPromise: Promise<void> | null = null;

  constructor(opts: {
    userDataDir: string;
    helperPath: string;
  }) {
    this.helper = opts.helperPath;
    this.socketPath = path.join(os.tmpdir(), `control-deck-rd-${process.pid}.sock`);
    this.tokenDir = opts.userDataDir;
  }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.spawnDaemon().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async spawnDaemon(): Promise<void> {
    if (!fs.existsSync(this.helper)) {
      throw new Error(`remote-desktop helper missing: ${this.helper}`);
    }
    const proc = spawn(
      "python3",
      [this.helper, "--socket", this.socketPath, "--token-dir", this.tokenDir],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.proc = proc;

    const readyLine = await this.waitForReady(proc);
    if (!readyLine.ok) {
      throw new Error(`remote-desktop daemon failed to start: ${readyLine.error ?? "unknown"}`);
    }

    proc.stderr?.on("data", (chunk: Buffer) => {
      // Forward daemon warnings to Electron stderr so they show up in the
      // same log stream as the rest of main.ts output.
      process.stderr.write(`[remote-desktop] ${chunk.toString("utf8")}`);
    });

    proc.on("exit", (code) => {
      console.error(`[remote-desktop] daemon exited (code=${code})`);
      this.proc = null;
      this.drainQueue(new Error("remote-desktop daemon exited"));
      this.socket?.destroy();
      this.socket = null;
      this.initPromise = null;
    });

    await this.connectSocket();
  }

  private waitForReady(proc: ChildProcess): Promise<{ ok: boolean; error?: string; socket?: string }> {
    return new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("remote-desktop daemon ready-handshake timed out"));
      }, READY_TIMEOUT_MS);
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        clearTimeout(timer);
        proc.stdout?.off("data", onData);
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(new Error(`remote-desktop daemon sent invalid handshake: ${err}`));
        }
      };
      proc.stdout?.on("data", onData);
      proc.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`remote-desktop daemon exited during startup (code=${code})`));
      });
    });
  }

  private async connectSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      const onError = (err: Error) => {
        sock.destroy();
        reject(err);
      };
      sock.once("error", onError);
      sock.once("connect", () => {
        sock.off("error", onError);
        this.socket = sock;
        sock.on("data", (chunk: Buffer) => this.onData(chunk));
        sock.on("error", (err) => {
          console.error("[remote-desktop] socket error:", err);
          this.drainQueue(err);
        });
        sock.on("close", () => {
          this.drainQueue(new Error("remote-desktop socket closed"));
          this.socket = null;
        });
        resolve();
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.readBuffer += chunk.toString("utf8");
    for (;;) {
      const nl = this.readBuffer.indexOf("\n");
      if (nl < 0) return;
      const line = this.readBuffer.slice(0, nl);
      this.readBuffer = this.readBuffer.slice(nl + 1);
      const pending = this.queue.shift();
      if (!pending) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        pending.resolve(parsed);
      } catch (err) {
        pending.reject(new Error(`invalid daemon response: ${err}`));
      }
    }
  }

  private drainQueue(err: Error): void {
    const pending = this.queue.splice(0, this.queue.length);
    for (const p of pending) p.reject(err);
  }

  private async request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.init();
    if (!this.socket) throw new Error("remote-desktop socket not connected");
    const socket = this.socket;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove our entry from the queue (best-effort — responses arrive in
        // order so removing the matching slot is tricky under concurrency; we
        // keep a simple FIFO and let the stale resolve land on the next slot
        // if the daemon eventually replies late).
        const idx = this.queue.indexOf(pending);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new Error(`remote-desktop request timed out: ${payload.op}`));
      }, CALL_TIMEOUT_MS);
      const pending: PendingRequest = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.queue.push(pending);
      socket.write(JSON.stringify(payload) + "\n", (err) => {
        if (err) {
          // If the write failed we never got a slot reservation consumed by a
          // response — drop it now so the queue stays aligned.
          const idx = this.queue.indexOf(pending);
          if (idx >= 0) this.queue.splice(idx, 1);
          pending.reject(err);
        }
      });
    });
  }

  async status(): Promise<RemoteDesktopStatus> {
    if (!this.proc) {
      return { keyboardReady: false, pointerReady: false, alive: false };
    }
    const res = await this.request({ op: "status" });
    return {
      keyboardReady: Boolean(res.keyboard_ready),
      pointerReady: Boolean(res.pointer_ready),
      alive: true,
    };
  }

  async key(args: RemoteDesktopKeyArgs): Promise<void> {
    const res = await this.request({
      op: "key",
      keysym: args.keysym,
      modifiers: args.modifiers ?? [],
    });
    if (!res.ok) throw new Error(String(res.error ?? "key failed"));
  }

  async type(text: string): Promise<void> {
    const res = await this.request({ op: "type", text });
    if (!res.ok) throw new Error(String(res.error ?? "type failed"));
  }

  async clickPixel(args: RemoteDesktopClickArgs): Promise<void> {
    const res = await this.request({
      op: "click_pixel",
      x: args.x,
      y: args.y,
      button: args.button ?? "left",
    });
    if (!res.ok) throw new Error(String(res.error ?? "click_pixel failed"));
  }

  async close(): Promise<void> {
    this.socket?.end();
    this.socket = null;
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
    }
    this.proc = null;
    try {
      if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath);
    } catch {
      /* best effort */
    }
  }
}
