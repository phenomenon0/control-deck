import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, type IPty } from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import type {
  CreateTerminalSessionInput,
  TerminalClientMessage,
  TerminalServerMessage,
  TerminalSession,
} from "../lib/terminal/types";

const HOST = process.env.TERMINAL_SERVICE_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TERMINAL_SERVICE_PORT ?? "4010");
const MAX_HISTORY_BYTES = 1_000_000;

interface SessionRecord extends TerminalSession {
  pty: IPty | null;
  sockets: Set<WebSocket>;
  history: string[];
  historyBytes: number;
  generation: number;
}

const sessions = new Map<string, SessionRecord>();
const wss = new WebSocketServer({ noServer: true });

function nowIso(): string {
  return new Date().toISOString();
}

const IS_WIN = process.platform === "win32";

function shellPath(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (IS_WIN) return process.env.COMSPEC || "cmd.exe";
  return "/bin/bash";
}

function normalizeCwd(input?: string): string {
  const fallback = process.env.HOME || process.cwd();
  if (!input) return fallback;
  const cwd = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!existsSync(cwd)) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }
  return cwd;
}

function createShellLabel(): string {
  let index = 1;
  while (true) {
    const label = `shell-${index}`;
    const exists = Array.from(sessions.values()).some((session) => session.label === label);
    if (!exists) return label;
    index += 1;
  }
}

function defaultLabel(profile: CreateTerminalSessionInput["profile"], name?: string): string {
  if (name?.trim()) return name.trim();
  if (profile === "shell") return createShellLabel();
  return profile;
}

function serializeSession(session: SessionRecord): TerminalSession {
  return {
    id: session.id,
    label: session.label,
    profile: session.profile,
    status: session.status,
    pid: session.pid,
    cwd: session.cwd,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    exitCode: session.exitCode,
    error: session.error,
  };
}

function sendJson(ws: WebSocket, message: TerminalServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(session: SessionRecord, message: TerminalServerMessage): void {
  for (const socket of session.sockets) {
    sendJson(socket, message);
  }
}

function appendHistory(session: SessionRecord, data: string): void {
  session.history.push(data);
  session.historyBytes += Buffer.byteLength(data);

  while (session.historyBytes > MAX_HISTORY_BYTES && session.history.length > 0) {
    const removed = session.history.shift();
    if (removed) {
      session.historyBytes -= Buffer.byteLength(removed);
    }
  }
}

function commandExists(command: string): boolean {
  if (IS_WIN) {
    const result = spawnSync("where", [command], { stdio: "ignore", shell: false });
    return result.status === 0;
  }
  const shell = shellPath();
  const result = spawnSync(shell, ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function profileLaunchSpec(session: SessionRecord): { file: string; args: string[] } {
  const shell = shellPath();
  if (session.profile === "shell") {
    return { file: shell, args: IS_WIN ? [] : ["-l"] };
  }

  const command = session.profile === "claude" ? "claude" : "opencode";
  if (!commandExists(command)) {
    throw new Error(`${command} is not installed or not on PATH for ${shell}.`);
  }

  if (IS_WIN) {
    return { file: command, args: [] };
  }

  return {
    file: shell,
    args: ["-lc", `exec ${command}`],
  };
}

function startSession(session: SessionRecord): SessionRecord {
  const generation = session.generation + 1;
  session.generation = generation;
  session.status = "starting";
  session.error = null;
  session.exitCode = null;
  session.history = [];
  session.historyBytes = 0;
  session.lastActiveAt = nowIso();
  session.startedAt = nowIso();

  broadcast(session, { type: "status", status: "starting" });

  try {
    const launch = profileLaunchSpec(session);
    const ptyProcess = spawn(launch.file, launch.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 36,
      cwd: session.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });

    session.pty = ptyProcess;
    session.pid = ptyProcess.pid;
    session.status = "running";
    session.lastActiveAt = nowIso();

    broadcast(session, { type: "status", status: "running" });
    broadcast(session, {
      type: "meta",
      cwd: session.cwd,
      pid: session.pid,
      profile: session.profile,
      label: session.label,
      status: session.status,
      exitCode: session.exitCode,
      error: session.error,
    });

    ptyProcess.onData((data) => {
      if (session.generation !== generation) return;
      session.lastActiveAt = nowIso();
      appendHistory(session, data);
      broadcast(session, { type: "output", data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (session.generation !== generation) return;
      session.pty = null;
      session.pid = null;
      session.exitCode = exitCode;
      session.status = exitCode === 0 ? "exited" : "error";
      session.error = exitCode === 0 ? null : `Process exited with code ${exitCode}.`;
      session.lastActiveAt = nowIso();

      broadcast(session, {
        type: "exit",
        exitCode,
        signal: signal !== undefined ? String(signal) : undefined,
      });
      broadcast(session, { type: "status", status: session.status });
      broadcast(session, {
        type: "meta",
        cwd: session.cwd,
        pid: null,
        profile: session.profile,
        label: session.label,
        status: session.status,
        exitCode: session.exitCode,
        error: session.error,
      });
    });
  } catch (err) {
    session.pty = null;
    session.pid = null;
    session.status = "error";
    session.error = err instanceof Error ? err.message : "Unable to launch process.";
    session.lastActiveAt = nowIso();
    broadcast(session, { type: "status", status: "error" });
    broadcast(session, {
      type: "meta",
      cwd: session.cwd,
      pid: null,
      profile: session.profile,
      label: session.label,
      status: session.status,
      exitCode: null,
      error: session.error,
    });
  }

  return session;
}

function stopForRestart(session: SessionRecord): void {
  if (!session.pty) return;
  const current = session.pty;
  session.pty = null;
  session.pid = null;
  session.generation += 1;
  try {
    current.kill();
  } catch {
    // Ignore kill failures during restart.
  }
}

function killSession(session: SessionRecord): SessionRecord {
  if (session.pty) {
    try {
      session.pty.kill();
    } catch (err) {
      session.status = "error";
      session.error = err instanceof Error ? err.message : "Unable to kill process.";
      session.lastActiveAt = nowIso();
    }
  }
  return session;
}

function upsertSession(input: CreateTerminalSessionInput): SessionRecord {
  const label = defaultLabel(input.profile, input.name);
  const cwd = normalizeCwd(input.cwd);

  if (input.profile !== "shell") {
    const existing = Array.from(sessions.values()).find(
      (session) => session.profile === input.profile && session.label === label,
    );
    if (existing) {
      existing.cwd = cwd;
      if (existing.status !== "running") {
        startSession(existing);
      }
      return existing;
    }
  }

  const session: SessionRecord = {
    id: crypto.randomUUID(),
    label,
    profile: input.profile,
    status: "starting",
    pid: null,
    cwd,
    startedAt: nowIso(),
    lastActiveAt: nowIso(),
    exitCode: null,
    error: null,
    pty: null,
    sockets: new Set(),
    history: [],
    historyBytes: 0,
    generation: 0,
  };

  sessions.set(session.id, session);
  startSession(session);
  return session;
}

async function readJsonBody<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function setCorsHeaders(response: http.ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

function writeJson(response: http.ServerResponse, status: number, body: unknown): void {
  setCorsHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function matchSessionRoute(pathname: string): { id: string; action: string | null } | null {
  const match = pathname.match(/^\/sessions\/([^/]+)(?:\/(restart|kill|ws))?$/);
  if (!match) return null;
  return {
    id: decodeURIComponent(match[1]),
    action: match[2] ?? null,
  };
}

function listSessions(): TerminalSession[] {
  return Array.from(sessions.values())
    .sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt))
    .map(serializeSession);
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    writeJson(response, 400, { error: "Missing request URL." });
    return;
  }

  if (request.method === "OPTIONS") {
    setCorsHeaders(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const route = matchSessionRoute(url.pathname);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        sessions: sessions.size,
        running: Array.from(sessions.values()).filter((session) => session.status === "running").length,
        host: HOST,
        port: PORT,
        timestamp: nowIso(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sessions") {
      writeJson(response, 200, { sessions: listSessions() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sessions") {
      const body = await readJsonBody<CreateTerminalSessionInput>(request);
      if (!body.profile || !["claude", "opencode", "shell"].includes(body.profile)) {
        writeJson(response, 400, { error: "profile must be one of claude, opencode, or shell." });
        return;
      }
      const session = upsertSession(body);
      writeJson(response, 200, { session: serializeSession(session) });
      return;
    }

    if (route && route.action === "restart" && request.method === "POST") {
      const session = sessions.get(route.id);
      if (!session) {
        writeJson(response, 404, { error: "Session not found." });
        return;
      }
      stopForRestart(session);
      startSession(session);
      writeJson(response, 200, { session: serializeSession(session) });
      return;
    }

    if (route && route.action === "kill" && request.method === "POST") {
      const session = sessions.get(route.id);
      if (!session) {
        writeJson(response, 404, { error: "Session not found." });
        return;
      }
      killSession(session);
      writeJson(response, 200, { session: serializeSession(session) });
      return;
    }

    if (route && !route.action && request.method === "DELETE") {
      const session = sessions.get(route.id);
      if (!session) {
        writeJson(response, 404, { error: "Session not found." });
        return;
      }
      if (session.pty) {
        try {
          session.pty.kill();
        } catch {
          // Ignore delete-time kill failures.
        }
      }
      for (const socket of session.sockets) {
        socket.close(1000, "Session deleted");
      }
      sessions.delete(route.id);
      setCorsHeaders(response);
      response.statusCode = 204;
      response.end();
      return;
    }

    writeJson(response, 404, { error: "Not found." });
  } catch (err) {
    writeJson(response, 500, {
      error: err instanceof Error ? err.message : "Unexpected terminal service error.",
    });
  }
});

server.on("upgrade", (request, socket, head) => {
  if (!request.url) {
    socket.destroy();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const route = matchSessionRoute(url.pathname);
  if (!route || route.action !== "ws") {
    socket.destroy();
    return;
  }

  const session = sessions.get(route.id);
  if (!session) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    session.sockets.add(ws);

    sendJson(ws, { type: "status", status: session.status });
    sendJson(ws, {
      type: "meta",
      cwd: session.cwd,
      pid: session.pid,
      profile: session.profile,
      label: session.label,
      status: session.status,
      exitCode: session.exitCode,
      error: session.error,
    });
    for (const chunk of session.history) {
      sendJson(ws, { type: "output", data: chunk });
    }
    if (session.exitCode !== null) {
      sendJson(ws, { type: "exit", exitCode: session.exitCode });
    }

    ws.on("message", (raw) => {
      let message: TerminalClientMessage;
      try {
        message = JSON.parse(String(raw)) as TerminalClientMessage;
      } catch {
        return;
      }

      if (message.type === "input" && session.pty) {
        session.lastActiveAt = nowIso();
        session.pty.write(message.data);
      }

      if (message.type === "resize" && session.pty) {
        const cols = Math.max(20, Math.floor(message.cols));
        const rows = Math.max(8, Math.floor(message.rows));
        session.pty.resize(cols, rows);
      }

      if (message.type === "ping") {
        sendJson(ws, { type: "status", status: session.status });
      }
    });

    ws.on("close", () => {
      session.sockets.delete(ws);
    });
  });
});

function shutdown(): void {
  for (const session of sessions.values()) {
    if (session.pty) {
      try {
        session.pty.kill();
      } catch {
        // Ignore shutdown kill failures.
      }
    }
    for (const socket of session.sockets) {
      socket.close(1001, "Terminal service shutting down");
    }
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  const baseUrl = `http://${HOST}:${PORT}`;
  console.log(`[terminal-service] listening on ${baseUrl} (${os.platform()})`);
});
